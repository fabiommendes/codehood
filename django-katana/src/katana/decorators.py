import copy
from http.client import HTTPResponse
from typing import Any, Callable

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpRequest

from .types import Fn, NOT_SET, MethodExample, setdefault_meta


def example(
    summary: str,
    params: dict[str, Any] | list[Any],
    description: str = NOT_SET,
    result: Any = NOT_SET,
) -> Callable[[Fn], Fn]:
    """
    Decorator to add an example to a method.

    Args:
        summary:
            Short description of the example
        params (dict|list):
            Input parameters. The input dictionary may contain a "return"
            key with the return value of the example. For methods called with
            positional arguments, the list should contain the arguments in order.
        description:
            Long description of the example.
        returns (Any):
            The return value of the example. If not provided, it will be
            extracted by from the params dictionary. If neither is provided,
            it will call the function to get the return value.
    """
    params = copy.copy(params)

    try:
        result = params.pop("return")  # type: ignore
    except TypeError:
        pass

    compute_result = result is NOT_SET and getattr(
        settings, "KATANA_COMPUTE_MISSING_RESULTS", True
    )

    if result is NOT_SET and not compute_result:
        raise ImproperlyConfigured(
            "Could not determine the result of an example. Either set the "
            "result argument in the decorator or pass a 'return' key to the "
            "params dictionary."
        )

    def decorator(func):
        if compute_result:
            request = synthetic_response()
            result_ = func(request, **params)
        else:
            result_ = result

        func_name = func.__name__
        example = MethodExample(
            summary=summary,
            description=description,
            params={func_name: params},
            result=result_,
        )
        setdefault_meta(func, {"examples": [example]})
        return func

    return decorator


def synthetic_response() -> HTTPResponse:
    """
    Create a synthetic HTTP response object to be used in decorators.
    """
    request = HttpRequest()
    request.method = "POST"
    request.path = "/"
    raise NotImplementedError  # TODO
