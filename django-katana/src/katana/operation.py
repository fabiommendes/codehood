import inspect
from typing import Any, Callable, Literal, Mapping, Sequence

from django.http import HttpRequest
from django.http.response import HttpResponseBase
from ninja import Schema
from ninja.params.models import TModels
from ninja.signature import ViewSignature
from ninja.signature.utils import get_typed_signature
from ninja.throttling import BaseThrottle
from ninja.operation import Operation as NinjaOperation
from pydantic import create_model

from .types import EMPTY_DICT, NOT_SET, MethodExample
from .errors import JsonRpcError


class Operation:
    def __init__(
        self,
        method: Callable,
        *,
        name: str = NOT_SET,
        positional: bool = False,
        auth: Any = NOT_SET,
        errors: Sequence[type[JsonRpcError]] = (),
        throttle: BaseThrottle | Sequence[BaseThrottle] = NOT_SET,
        response: Any = NOT_SET,
        summary: str | None = None,
        description: str | None = None,
        examples: Sequence[MethodExample] = (),
        tags: Sequence[str] = (),
        deprecated: bool | None = None,
        include_in_schema: bool = True,
        openapi_extra: Mapping[str, Any] = EMPTY_DICT(),
    ) -> None:
        self.is_async = False
        self.name: str = name or method.__name__
        self.positional = positional
        self.errors = errors
        self.method: Callable = method
        self.operation_id: str | None = None
        if self.positional:
            self.view_function = self._get_positional_view_func(method)
        else:
            self.view_function = self._get_kwargs_view_func(method)

        self.auth_param: Sequence[Callable] | Callable | object = auth
        self.auth_callbacks: Sequence[Callable] = []
        self._set_auth(auth)  # type: ignore[assignment]

        if isinstance(throttle, BaseThrottle):
            throttle = [throttle]
        self.throttle_param = throttle
        self.throttle_objects: list[BaseThrottle] = []

        if throttle is not NOT_SET:
            for th in throttle:  # type: ignore
                assert isinstance(th, BaseThrottle), (
                    "Throttle should be an instance of BaseThrottle"
                )
                self.throttle_objects.append(th)

        self.signature = ViewSignature(self.name, self.view_function)
        self.models: TModels = self.signature.models

        self.response_models: dict[Any, Any]
        if response is NOT_SET:
            self.response_models = {200: NOT_SET}
        elif isinstance(response, dict):
            self.response_models = self._create_response_model_multiple(
                response)
        else:
            self.response_models = {200: self._create_response_model(response)}

        self.summary = summary or self.method.__name__.title().replace("_", " ")
        self.description = description or self.signature.docstring
        self.tags = [*tags]
        self.examples = [*examples]
        self.deprecated = deprecated
        self.include_in_schema = include_in_schema
        self.openapi_extra = openapi_extra

        if hasattr(method, "_ninja_contribute_to_operation"):
            # Allow 3rd party code to contribute to the operation behavior
            callbacks: list[Callable] = method._ninja_contribute_to_operation
            for callback in callbacks:
                callback(self)

    def run(self, request: HttpRequest, **kw: Any) -> HttpResponseBase:
        error = self._run_checks(request)
        if error:
            return error
        try:
            temporal_response = self.api.create_temporal_response(request)
            values = self._get_values(request, kw, temporal_response)
            result = self.method(request, **values)
            return self._result_to_response(request, result, temporal_response)
        except Exception as e:
            if isinstance(e, TypeError) and "required positional argument" in str(e):
                msg = "Did you fail to use functools.wraps() in a decorator?"
                msg = f"{e.args[0]}: {msg}" if e.args else msg
                e.args = (msg,) + e.args[1:]
            return self.api.on_exception(request, e)

    set_api_instance = NinjaOperation.set_api_instance
    _set_auth = NinjaOperation._set_auth
    _run_checks = NinjaOperation._run_checks
    _run_authentication = NinjaOperation._run_authentication
    _check_throttles = NinjaOperation._check_throttles
    _result_to_response = NinjaOperation._result_to_response
    _create_response_model_multiple = NinjaOperation._create_response_model_multiple
    _create_response_model = NinjaOperation._create_response_model
    _get_values = NinjaOperation._get_values

    def _get_positional_view_func(self, method):
        raise NotImplementedError(
            "Positional view functions are not supported yet.")

    def _get_kwargs_view_func(self, method):
        signature = get_typed_signature(method)
        out_t = signature.return_annotation
        annotations = {
            "id": int | str | None,
            "method": str,
            "params": kwargs_schema(self.name, signature),
            "jsonrpc": Literal["2.0"],
        }
        payload_t = create_model("Payload", __base__=Schema, **annotations)

        def wrapper(request: HttpRequest, payload: payload_t) -> out_t:  # type: ignore
            return method(request, **payload)

        return wrapper


def kwargs_schema(name: str, signature: inspect.Signature) -> type:
    params = {k: v for i, (k, v) in enumerate(
        signature.parameters.items()) if i}
    model_name = f"{name.title()}Params"

    annotations: dict[str, Any] = {}
    for name, param in params.items():
        typ = Any if param.annotation is param.empty else param.annotation
        if param.default is not param.empty:
            annotations[name] = typ, param.default
        else:
            annotations[name] = typ

    return create_model(model_name, __base__=Schema, **annotations)
