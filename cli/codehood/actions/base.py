from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, cast


#
# Protocols
#
class Action[
    T,
    Ctx = None,
](Protocol):
    """
    Base protocol for Action objects.

    Actions work like a thunk over a side-effect that we can inspect
    and compose. They expose a `run()` method that executes the action.

    Actions might accept an optional context that is used to store arguments and
    other contextual information about how the action was run
    """

    def run(self, ctx: Ctx | None = None, /) -> Result[T]:
        """
        Actually run the action.
        """
        ...


class Args[T](Protocol):
    """
    A context that exposes arguments that pass through an action.
    """

    args: T


#
# Action combinators
#
@dataclass(frozen=True)
class Seq[R1, R2, C1, C2](Action[R2, tuple[C1, C2]]):
    """
    Run two actions in sequence where the result of one do not interfere with
    the result of the other.

    The error of the first action takes precedence. If successful, returns the
    value of the second.
    """

    first: Action[R1, C1]
    second: Action[R2, C2]

    def run(self, ctx: tuple[C1, C2] | None = None, /) -> Result[R2]:
        ctx1, ctx2 = (None, None) if ctx is None else ctx
        if (res := self.first.run(ctx1)).is_error:
            return res.as_error_of(self.second)
        return self.second.run(ctx2)


@dataclass(frozen=True)
class Try[T, Ctx]:
    """
    Try any number of actions in and return the first successful one.

    Return the last error, if all attempts fail.
    """

    actions: tuple[Action[T, Ctx], ...]

    def __post_init__(self):
        if not self.actions:
            raise ValueError("must have at least one action in the list")

    def run(self, ctx: Ctx | None = None):
        first, *rest = self.actions
        res = first.run(ctx)
        for action in rest:
            if not res.is_error:
                return res
            res = action.run(ctx)
        return res


#
# Auxiliary types
#
@dataclass(frozen=True)
class Result[T]:
    """
    Describes the result of an action.
    """

    value: T | None
    errors: tuple[Error, ...] | None = None

    def __post_init__(self):
        if self.errors == ():
            object.__setattr__(self, "errors", ())

    @property
    def is_error(self):
        return self.errors is None

    def as_error_of[S](self, action: Action[S, Any]) -> Result[S]:
        """
        Cast an error result to a different type.
        """
        if self.value is None:
            return cast("Result[S]", self)
        raise ValueError("cannot cast a non-error result to a different type")


@dataclass
class Error[T = None]:
    message: str
    code: str
    data: T
