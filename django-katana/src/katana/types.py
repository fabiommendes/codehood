from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping, Sequence, TypeVar, TYPE_CHECKING, TypedDict

from ninja.throttling import BaseThrottle
import ninja.constants
import pjrpc.common
from pjrpc.server.specs import openapi as specs

from .errors import JsonRpcError

if TYPE_CHECKING:
    NOT_SET = NotImplemented
else:
    NOT_SET = ninja.constants.NOT_SET

ANNOTATION_ATTR = "__katana_annotations__"
SPECIAL_MERGE = ("examples",)
PJRPC_UNSET = pjrpc.common.UNSET


def EMPTY_DICT[K, V]() -> Mapping[K, V]:
    return MappingProxyType({})


Fn = TypeVar("Fn", bound=Callable[..., Any])
type DictStrAny = dict[str, Any]


@dataclass
class MethodExample:
    params: dict[str, Any]
    result: Any
    version: str = "2.0"
    summary: str = NOT_SET
    description: str = NOT_SET


class OpKwargs(TypedDict, total=False):
    name: str
    positional: bool
    auth: Any
    errors: list[type[JsonRpcError]]
    throttle: list[BaseThrottle]
    response: Any
    summary: str
    description: str
    tags: list[str]
    deprecated: bool
    openapi_extra: dict[str, Any]
    examples: list[MethodExample]
    include_in_schema: bool


def setdefault_meta(method, annotation: OpKwargs = NOT_SET) -> OpKwargs:
    """
    Get the annotation dictionary for a method.

    Create a new dictionary if it doesn't exist.
    """
    try:
        options: OpKwargs = getattr(method, ANNOTATION_ATTR)
    except AttributeError:
        setattr(method, ANNOTATION_ATTR, (options := {}))  # type:ignore
    merged = merge_annotations(options, annotation)
    setattr(method, ANNOTATION_ATTR, merged)
    return options


def merge_annotations(a: OpKwargs, b: OpKwargs) -> OpKwargs:
    """
    Merge two annotations dictionaries.

    This is a shallow merge. If the same key exists in both dictionaries,
    the value from the second dictionary be given precedence."""
    return {
        **a,
        **b,
        "examples": [*a.get("examples", []), *b.get("examples", [])],
        "tags": [*a.get("tags", []), *b.get("tags", [])],
        "errors": [*a.get("errors", []), *b.get("errors", [])],
        "throttle": [*a.get("throttle", []), *b.get("throttle", [])],
    }


def as_pjrpc_unset(value: Any) -> Any:
    """
    Convert a value to pjrpc.UNSET if it is NOT_SET.
    """
    if value is NOT_SET:
        return PJRPC_UNSET
    return value
