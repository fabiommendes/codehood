from __future__ import annotations

from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Concatenate,
    Literal,
    TypeVar,
    ParamSpec,
    TypedDict,
    Unpack,
)

from ninja.errors import ConfigError
from django.http import HttpRequest
from ninja.main import BaseThrottle


class _Dummy:
    pass


INTERNAL_FIELDS = frozenset(_Dummy.__dict__)
OPTIONS_ATTR = "__ninja_controller_api_options__"

if TYPE_CHECKING:
    _: Callable[[str], str]
    NOT_SET = NotImplemented
else:
    from django.utils.translation import gettext_lazy as _  # noqa: F401
    from ninja.main import NOT_SET  # noqa: F401


P = ParamSpec("P")
F = TypeVar("F", bound=Callable)
type Decorator[R, **P] = Callable[[Callable[P, R]], Callable[P, R]]
type AnyDecorator[F] = Callable[[F], F]
type Route[**P] = Callable[Concatenate[HttpRequest, P], Any]
type RouteMethod[S, **P, R] = Callable[Concatenate[S, HttpRequest, P], R]
type RouteOptions = list[RouteOption]
type ApiDecorator[F] = Callable[[str, Unpack[ApiKwargs]], Callable[[F], F]]
type AnyApiDecorator[F] = Callable[
    [list[str], str, Unpack[ApiKwargs]], Callable[[F], F]
]
type Action = Literal["create", "list", "read", "update", "delete", "put"]


class ApiKwargs(TypedDict, total=False):
    auth: Any
    throttle: BaseThrottle | list[BaseThrottle]
    response: Any
    operation_id: str | None
    summary: str | None
    description: str | None
    tags: list[str] | None
    deprecated: bool | None
    by_alias: bool | None
    exclude_unset: bool | None
    exclude_defaults: bool | None
    exclude_none: bool | None
    url_name: str | None
    include_in_schema: bool
    openapi_extra: dict[str, Any] | None


class RouteOption(ApiKwargs, total=False):
    path: str
    http_verb: str
    decorators: list[Decorator]


def push_route_option(method, option: RouteOption) -> RouteOptions:
    try:
        options = getattr(method, OPTIONS_ATTR)
    except AttributeError:
        setattr(method, OPTIONS_ATTR, (options := []))  # type:ignore
    options.append(option)
    return options  # type: ignore


def get_route_options(method) -> RouteOptions:
    try:
        return getattr(method, OPTIONS_ATTR)
    except AttributeError:
        name = method.__qualname__
        raise ConfigError(
            f"no routing options were found for {name}. "
            "Options are usually declared with decorators such as @api.get, @api.post, etc."
        )


def route_has_options(method) -> bool:
    return hasattr(method, OPTIONS_ATTR)
