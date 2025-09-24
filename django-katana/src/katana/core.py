from __future__ import annotations

from typing import Any, Callable, Iterator, Sequence, Unpack

from django.http import HttpRequest, HttpResponse
from django.urls import URLPattern, path
from django.utils.module_loading import import_string
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt

from ninja.responses import Response
from ninja import NinjaAPI
from ninja.errors import ConfigError
from ninja.openapi.docs import DocsBase, Swagger
from ninja.parser import Parser
from ninja.renderers import JSONRenderer
from ninja.throttling import BaseThrottle


from .openapi_schema import OpenAPISchema
from .types import DictStrAny, OpKwargs, Fn, NOT_SET
from .router import Router
from .operation import Operation
from .decorators import example
from . import errors

__all__ = ["KatanaRPC"]


type Exc[E: Exception] = E | type[E]
type ExcHandler[E: Exception] = Callable[[HttpRequest, Exc[E]], HttpResponse]

REQUEST_CONTENT_TYPES = (
    "application/json",
    "application/json-rpc",
    "application/jsonrequest",
)


class KatanaRPC(NinjaAPI):
    """
    A Katana RPC Server
    """

    _registry: list[str] = []
    _routers: list[tuple[str, Router]]  # type: ignore[assignment]
    auth: list[Callable]
    default_router: Router  # type: ignore[assignment]

    def __init__(
        self,
        *,
        title: str = "KatanaRPC",
        version: str = "1.0.0",
        description: str = "",
        openapi_url: str = "/openapi.json",
        docs: DocsBase = Swagger(),
        docs_url: str = "/docs",
        servers: list[DictStrAny] = NOT_SET,
        auth: list[Callable] | Callable = NOT_SET,
        throttle: BaseThrottle | list[BaseThrottle] = NOT_SET,
        renderer: JSONRenderer = JSONRenderer(),
        parser: Parser = Parser(),
        default_router: Router = NOT_SET,
        openapi_extra: dict[str, Any] = NOT_SET,
        urls_namespace: str = "katana",
    ):
        """
        Args:
            title:
                A title for the api.
            description:
                A description for the api.
            version:
                The API version.
            openapi_url:
                The relative URL to serve the openAPI spec.
            openapi_extra:
                Additional attributes for the openAPI spec.
            docs_url:
                The relative URL to serve the API docs.
            servers:
                List of target hosts used in openAPI spec.
            auth:
                Authentication class
            renderer:
                Default response renderer
            parser:
                Default request parser
        """
        super().__init__(
            title=title,
            version=version,
            description=description,
            openapi_url=openapi_url,
            docs=docs,
            docs_url=docs_url,
            servers=[] if servers is NOT_SET else [*servers],
            auth=auth,
            throttle=throttle,
            renderer=renderer,
            parser=parser,
            default_router=Router() if default_router is NOT_SET else default_router,  # type: ignore
            openapi_extra={} if openapi_extra is NOT_SET else openapi_extra,
            urls_namespace=urls_namespace,
        )

    def method(self, **kwargs: Unpack[OpKwargs]) -> Callable[[Fn], Fn]:
        return self.default_router.method(**kwargs)

    example = staticmethod(example)

    def api_operation(self, *args, **kwargs):
        raise ConfigError(
            "RPC API does not support HTTP methods. Use rpc.method() instead."
        )

    def add_router(  # type: ignore[override]
        self,
        prefix: str,
        router: Router | str,
        *,
        auth: Any = NOT_SET,
        throttle: BaseThrottle | list[BaseThrottle] = NOT_SET,
        tags: list[str] = NOT_SET,
    ) -> None:
        if isinstance(router, str):
            router = import_string(router)
            assert isinstance(router, Router)

        if auth is not NOT_SET:
            router.auth = auth
        if throttle is not NOT_SET:
            router.throttle = throttle
        if tags is not NOT_SET:
            router.tags = tags

        self._routers.append((prefix, router))

    @property
    def urls(self) -> tuple[list[URLPattern], str, str]:  # type: ignore[override]
        """
        URL configuration
        """
        openapi_url = self.openapi_url or "/openapi.json"
        openapi_url = openapi_url.removeprefix("/")
        schema = self.get_openapi_schema()
        def openapi_json_view(_): return Response(schema)

        urlpatterns = [
            path("", csrf_exempt(self._json_rpc_view)),
            path(openapi_url, openapi_json_view, name="openapi-json"),
            *(() if self.docs is None else docs_urlpatterns(self.docs, self)),
        ]
        return urlpatterns, "katana", "katana"

    def _json_rpc_view(
        self,
        request: HttpRequest,
        methods: dict[str, Operation],
    ) -> HttpResponse:
        """
        Process the JSON-RPC request.

        This method dispatch the request to the appropriate method based on the
        `method` field in the request body.

        Args:
            request (HttpRequest): _description_
            methods (dict[str, Operation]): _description_

        Raises:
            errors.InvalidRequestError: _description_
            HttpResponseBadRequest: _description_

        Returns:
            HttpResponse: _description_
        """
        if request.content_type not in REQUEST_CONTENT_TYPES:
            return HttpResponse(status=415)

        if request.method != "POST":
            raise errors.InvalidRequestError()

        # try:
        #     request_text = request.body.decode(request.encoding or "utf8")
        # except UnicodeDecodeError:
        #     raise HttpResponseBadRequest()

        # json = self.parser.parse_body(request)
        # self._check_json_payload(json)
        # qualname = json["method"]

        # try:
        #     operation = methods[qualname]
        # except KeyError:
        #     self.on_exception()

        return HttpResponse()

    def _spec_view(self, request: HttpRequest) -> HttpResponse:
        raise NotImplementedError

    def create_response(
        self,
        request: HttpRequest,
        data: Any,
        *,
        status: int | None = None,
        temporal_response: HttpResponse | None = None,
    ) -> HttpResponse:
        if temporal_response:
            status = temporal_response.status_code
        assert status

        content = self.renderer.render(request, data, response_status=status)

        if temporal_response:
            response = temporal_response
            response.content = content  # type: ignore
        else:
            response = HttpResponse(
                content, status=status, content_type=self.get_content_type()
            )

        return response

    def get_openapi_schema(self, **_kwargs) -> OpenAPISchema:
        return OpenAPISchema(self)

    def _validate(self) -> None:
        # # urls namespacing validation
        # skip_registry = os.environ.get("NINJA_SKIP_REGISTRY", False)
        # if (
        #     not skip_registry
        #     and self.urls_namespace in NinjaAPI._registry
        #     and not debug_server_url_reimport()
        # ):
        #     msg = f"""
        #     Looks like you created multiple NinjaAPIs or TestClients
        #     To let ninja distinguish them you need to set either unique version or urls_namespace
        #     - NinjaAPI(..., version='2.0.0')
        #     - NinjaAPI(..., urls_namespace='otherapi')
        #     Already registered: {NinjaAPI._registry}
        #     """
        #     raise ConfigError(msg.strip())
        # NinjaAPI._registry.append(self.urls_namespace)
        pass


def as_sequence[T](obj: T | Sequence[T]) -> list[T]:
    if isinstance(obj, Sequence):
        return [*obj]
    else:
        return [obj]


def set_or_else[T](obj: T, factory: Callable[[], T]) -> T:
    return factory() if obj is NOT_SET else obj


def unwrap[T](obj: T | None) -> T:
    if obj is None:
        raise ValueError("Cannot unwrap None")
    return obj


def docs_urlpatterns(docs: DocsBase, api: NinjaAPI) -> Iterator[URLPattern]:
    url = (api.docs_url or "/docs").removeprefix("/") + "/"

    @require_http_methods(["GET"])
    def docs_view(request: HttpRequest) -> HttpResponse:
        return docs.render_page(request, api)

    yield path(url, docs_view)
    yield path(url + "index.html", docs_view)
