import inspect
from types import FunctionType
from typing import Callable

from .core import NOT_SET


def is_method(func: Callable) -> bool:
    """
    Inspect if function is a method by checking if the first
    argument is named self.

    WARNING: this check is not infallible since self is not a reserved name.
        We just assume that clients are following standard python conventions.
    """
    sig = inspect.signature(func)
    return "self" in sig.parameters


def setdefaultattr[T](obj, attr: str, value: T) -> T:
    """
    Similar to dict.setdefault, but for attributes.
    """
    try:
        return getattr(obj, attr)
    except AttributeError:
        setattr(obj, attr, value)
        return getattr(obj, attr)


def setdefaultvalue(map: dict, key, value):
    """
    Set value in dict, unless value already exists or is None or NOT_SET
    """
    if value is not None and value is not NOT_SET and key not in map:
        map[key] = value
    return map.get(key, None)


def popattr[T](obj, attr: str, value: T = NOT_SET) -> T:
    """
    Remove and return attribute.
    """
    try:
        value = getattr(obj, attr)
        delattr(obj, attr)
    except AttributeError:
        if value is NOT_SET:
            raise
    finally:
        return value


def compressed(map: dict) -> dict:
    """
    Return dict removing all entries that maps to either None or NOT_SET
    """
    return {k: v for k, v in map.items() if v is not None and v is not NOT_SET}


def copy_function(func: FunctionType) -> FunctionType:
    """
    Return a copy of the given function.
    """
    return FunctionType(
        code=func.__code__,
        globals=func.__globals__,
        name=func.__name__,
        argdefs=func.__defaults__,
        closure=func.__closure__,
        kwdefaults=func.__kwdefaults__,
    )
