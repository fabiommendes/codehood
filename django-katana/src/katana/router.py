from __future__ import annotations

from typing import Any, Callable, Iterator, Sequence, Unpack

from ninja.throttling import BaseThrottle

from .types import NOT_SET, OpKwargs
from .operation import Operation
from .decorators import example

__all__ = ["Router"]


class Router:
    def __init__(
        self,
        *,
        auth: Any = NOT_SET,
        throttle: BaseThrottle | Sequence[BaseThrottle] = (),
        tags: Sequence[str] = (),
        by_alias: bool | None = None,
    ) -> None:
        self.auth = auth
        self.throttle = throttle
        self.tags = [*tags]
        self.by_alias = by_alias
        self._operations: dict[str, Operation] = {}

    example = staticmethod(example)

    def method[F: Callable](self, **kwargs: Unpack[OpKwargs]) -> Callable[[F], F]:
        def decorator(view_func: F) -> F:
            self.add_method(view_func, **kwargs)
            return view_func

        return decorator

    def add_method(self, method: Callable, **kwargs: Unpack[OpKwargs]) -> None:
        name = kwargs.get("name", method.__name__)
        kwargs["name"] = name
        operation = Operation(method, **kwargs)
        self._operations[name] = operation

    def method_mapping(self, prefix: str) -> Iterator[tuple[str, Operation]]:
        for path, operation in self._operations.items():
            qualname = ".".join([i for i in (prefix, path) if i])
            # to skip lot of checks we simply treat double dots as a mistake:
            qualname = normalize_path(qualname)
            qualname = qualname.lstrip(".")

            yield qualname, operation


def normalize_path(path: str) -> str:
    while ".." in path:
        path = path.replace("..", ".")
    return path
