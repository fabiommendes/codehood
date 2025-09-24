from __future__ import annotations

from types import FunctionType
from typing import (
    Any,
    Callable,
    Iterable,
    Mapping,
    Sequence,
    Unpack,
    cast,
)

from ninja import NinjaAPI, Swagger
from ninja.errors import ConfigError
from ninja.main import (
    BaseRenderer,
    BaseThrottle,
    DocsBase,
    Parser,
    Router,
    TCallable as Fn,
)

from .controllers.base import BaseController
from .core import (
    NOT_SET,
    AnyDecorator,
    Decorator,
    F,
    ApiKwargs,
    ApiDecorator,
    RouteOption,
    push_route_option,
)
from .utils import is_method


class ShurikenAPI(NinjaAPI):
    """
    A Ninja-based API that allows class-based views.
    """

    def get(self, path: str, **kwargs: Unpack[ApiKwargs]) -> Callable[[Fn], Fn]:  # type: ignore[override]
        return flexible_api_decorator(super().get, kwargs, path=path)

    def post(self, path, **kwargs: Unpack[ApiKwargs]) -> Callable[[Fn], Fn]:  # type: ignore[override]
        return flexible_api_decorator(super().post, kwargs, path=path)

    def delete(self, path: str, **kwargs: Unpack[ApiKwargs]) -> Callable[[Fn], Fn]:  # type: ignore[override]
        return flexible_api_decorator(super().delete, kwargs, path=path)

    def patch(self, path: str, **kwargs: Unpack[ApiKwargs]) -> Callable[[Fn], Fn]:  # type: ignore[override]
        return flexible_api_decorator(super().patch, kwargs, path=path)

    def put(self, path: str, **kwargs: Unpack[ApiKwargs]) -> Callable[[Fn], Fn]:  # type: ignore[override]
        return flexible_api_decorator(super().put, kwargs, path=path)

    def api_operation(  # type: ignore[override]
        self, methods: list[str], path: str, **kwargs: Unpack[ApiKwargs]
    ) -> Callable[[Fn], Fn]:
        return flexible_api_decorator(
            super().api_operation, kwargs, path=path, methods=methods
        )

    def __init__(
        self,
        *,
        title: str = "NinjaAPI",
        version: str = "1.0.0",
        description: str = "",
        openapi_url: str | None = "/openapi.json",
        docs: DocsBase = Swagger(),
        docs_url: str | None = "/docs",
        docs_decorator: Decorator | None = None,
        servers: list[dict[str, Any]] | None = None,
        urls_namespace: str | None = None,
        csrf: bool = False,
        auth: Sequence[Callable] | Callable | None = NOT_SET,
        throttle: BaseThrottle | list[BaseThrottle] = NOT_SET,
        renderer: BaseRenderer | None = None,
        parser: Parser | None = None,
        default_router: Router | None = None,
        openapi_extra: dict[str, Any] | None = None,
    ):
        self.controllers: list[BaseController] = []
        super().__init__(
            title=title,
            version=version,
            description=description,
            openapi_url=openapi_url,
            docs=docs,
            docs_url=docs_url,
            docs_decorator=docs_decorator,
            servers=servers,
            urls_namespace=urls_namespace,
            csrf=csrf,
            auth=auth,
            throttle=throttle,
            renderer=renderer,
            parser=parser,
            default_router=default_router,
            openapi_extra=openapi_extra,
        )

    def controller(
        self,
        path: str,
        *,
        auth: Any = NOT_SET,
        throttle: BaseThrottle | list[BaseThrottle] = NOT_SET,
        tags: Sequence[str] = (),
        deprecated: bool | None = None,
        exclude_unset: bool | None = None,
        exclude_defaults: bool | None = None,
        exclude_none: bool | None = None,
        include_in_schema: bool = True,
        openapi_extra: Mapping[str, Any] = {},
        decorators: Iterable[AnyDecorator] = (),
    ):
        def decorator(controller_class: type[BaseController]):
            router = Router(
                auth=auth,
                throttle=throttle,
                tags=[*tags],
                exclude_unset=exclude_unset,
                exclude_defaults=exclude_defaults,
                exclude_none=exclude_none,
            )
            controller = controller_class(
                router=router,
                deprecated=deprecated,
                include_in_schema=include_in_schema,
                openapi_extra=openapi_extra,
                decorators=decorators,
            )
            self.controllers.append(controller)
            self.add_router(path, controller.router)

            return controller_class

        return decorator

    def decorate(self, *decorators: AnyDecorator) -> AnyDecorator:
        """
        Called to apply decorators to api methods.

        Most decorators assume view functions that receive the request as the first
        parameter and mishandle the self argument of methods.

        A Ninja function decorated as

            @api.get("/view")
            @csrf_exempt
            @never_cache
            def view_function(request, *args):
                ...

        Would be translated to a method

            @api.get("/view")
            @api.decorate(csrf_exempt, never_cache)
            def view_method(self, request, *args):
                ...

        The @api.decorate() decorator also work in regular functions.
        """

        # We reverse because decorators apply from bottom to top
        decorators = reversed(decorators)  # type: ignore[assignment]

        def decorator(method):
            if not is_method(method):
                for decorator in decorators:
                    method = decorator(method)
                return method

            push_route_option(method, {"decorators": [*decorators]})
            return method

        return decorator


def flexible_api_decorator(bound_decorator, kwargs: ApiKwargs, **extra):
    """
    Modify the behaviour of get/post/delete/patch/put methods of NinjaAPI.

    The new method can decorate both regular functions and methods inside a Controller class.
    """

    def decorator(impl: FunctionType):
        options = cast(RouteOption, {**kwargs, **extra})
        if not is_method(impl):
            return bound_decorator(**options)(impl)

        options["http_verb"] = bound_decorator.__name__
        if not isinstance(impl, FunctionType):
            raise ConfigError(
                "It seems that you have already applied a decorator to this method.\n"
                "Please make sure to apply decorators using the @api.decorate() decorator."
            )
        push_route_option(impl, options)
        return impl

    return decorator


def make_unbound_decorator(http_method: str) -> ApiDecorator:
    """
    Create @get, @post, etc decorators that do not require an ControllerAPI
    instance to declare a method as a view function.
    """

    def build_decorator(path: str, **kwargs: Unpack[ApiKwargs]):
        def decorator(impl: F) -> F:
            options: RouteOption = {**kwargs}
            options["path"] = path
            options["http_verb"] = http_method
            push_route_option(impl, options)
            return impl

        decorator.__name__ = "decorator"
        decorator.__qualname__ = f"{http_method}.decorator"
        return decorator

    build_decorator.__name__ = http_method
    build_decorator.__qualname__ = http_method
    return build_decorator


get: ApiDecorator = make_unbound_decorator("get")
post: ApiDecorator = make_unbound_decorator("post")
delete: ApiDecorator = make_unbound_decorator("delete")
patch: ApiDecorator = make_unbound_decorator("patch")
put: ApiDecorator = make_unbound_decorator("put")
