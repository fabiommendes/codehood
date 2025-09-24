from __future__ import annotations

from dataclasses import dataclass
from functools import wraps
from types import FunctionType, MethodType
from typing import Any, Callable, ClassVar, Iterable, Mapping, TYPE_CHECKING

from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import ImproperlyConfigured
from django.contrib.auth import get_user_model
from django.http import Http404, HttpRequest
from ninja import Router
from ninja.errors import ConfigError

from logging import getLogger


from ..core import (
    INTERNAL_FIELDS,
    AnyDecorator,
    RouteMethod,
    get_route_options,
    route_has_options,
)
from ..utils import setdefaultvalue
from ..core import RouteOptions

log = getLogger(__name__)


class BaseController:
    """
    Defines the basic Controller interface
    """

    registry: ClassVar[tuple[tuple[str, RouteMethod, RouteOptions], ...]] = ()

    def __init__(
        self,
        *,
        router: Router | None = None,
        deprecated: bool | None = None,
        include_in_schema: bool = True,
        openapi_extra: Mapping[str, Any] = {},
        decorators: Iterable[AnyDecorator] = (),
    ):
        self.router: Router = router or Router()
        self.deprecated = deprecated
        self.include_in_schema = include_in_schema
        self.openapi_extra = {**openapi_extra}
        self.decorators = [*decorators]

        # Register routes
        base_options = {
            "openapi_extra": self.openapi_extra,
            "decorators": self.decorators,
        }
        setdefaultvalue(base_options, "deprecated", self.deprecated)
        setdefaultvalue(base_options, "include_in_schema", self.include_in_schema)
        for _, route, options in self.registry:
            self._register_route(self.router, route, base_options, options)

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)

        methods = [*getattr(cls, "registry", [])]
        for name, method in public_methods(cls, stop=BaseController):
            if not route_has_options(method):
                continue
            methods.append((name, method, get_route_options(method)))
        cls.registry = tuple(methods)

    def __hash__(self):
        return id(self)

    def _register_route(
        self,
        router: Router,
        method: RouteMethod,
        base_options: dict[str, Any],
        method_options: RouteOptions,
    ):
        assert isinstance(method_options, list), method_options

        finalize = False
        base_options = base_options.copy()
        method_name = method.__name__

        @wraps(MethodType(method, self))
        def impl(*args, **kwargs):
            return method(self, *args, **kwargs)

        for opts in method_options:
            http_verb = opts.get("http_verb")
            extra = dict(opts)

            if http_verb:
                extra.pop("http_verb")
                finalize = True
                kwargs = base_options.copy()
                merge_options(kwargs, extra)

                for decorator in kwargs.pop("decorators", ()):
                    impl = decorator(impl)

                try:
                    path = kwargs.pop("path")
                    http_verb = http_verb.upper()
                    router.add_api_operation(path, [http_verb], impl, **kwargs)
                except ConfigError:
                    # FIXME: Tracking a hard to fix bug...
                    log.critical(f"error creating {method_name}({http_verb})")
                    break

            elif finalize:
                raise ImproperlyConfigured(
                    "You cannot put decorators above the final declaration of @api.get(), @api.post(), etc.\n"
                    "This error usually occurs if one place @api.decorators() above @api.<http_method>.\n"
                    "Please check if it is not the case.\n"
                )
            else:
                merge_options(base_options, extra)

        if not finalize:
            raise ImproperlyConfigured(
                "Maybe you forgot to decorate an api method %s with one of @api.get(), @api.post(), etc.\n"
                % method.__name__
            )

    def get_user_or_404(self, request: HttpRequest):
        """
        Return the user or a 404 if user is not authenticated.
        """
        if isinstance(user := request.user, AnonymousUser):
            raise Http404("user is not authenticated")
        return cast(get_user_model(), user)


def cast[T](t: type[T], x: Any) -> T:
    return x


def public_methods(cls: type, stop=None) -> Iterable[tuple[str, Callable]]:
    yielded = set()
    for base in cls.__mro__:
        if base is stop:
            return

        for name, impl in base.__dict__.items():
            if (
                name not in yielded
                and type(impl) is FunctionType
                and not name.startswith("_")
            ):
                yielded.add(name)
                yield (name, impl)


def merge_options(base: dict, extra: dict):
    """
    Merge base options with extra declarations changing both dicts *inplace*
    """
    base["decorators"].extend(extra.pop("decorators", ()))
    base["openapi_extra"].update(extra.pop("openapi_extra", {}))
    base.update(**extra)
    extra.clear()


@dataclass
class MetaConf:
    url_prefix: str

    @staticmethod
    def from_schema_meta(cls: type[BaseController], meta, validate=True) -> MetaConf:
        if validate:
            validate_meta_attrs(set(meta.__dict__.keys()))

        url_prefix = getattr(meta, "url_prefix", "api")

        return MetaConf(
            url_prefix=url_prefix,
        )


def validate_meta_attrs(fields: set):
    if invalid := fields - MetaConf.__annotations__.keys() - INTERNAL_FIELDS:
        field = next(iter(invalid))
        raise ConfigError(
            "%s is not supported in the 'Meta' class declaration." % field
        )
