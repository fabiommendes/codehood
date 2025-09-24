"""
Definition of package exceptions and JSON-RPC protocol errors.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, ClassVar


if TYPE_CHECKING:
    NOT_SET = NotImplemented
else:
    from ninja.constants import NOT_SET


class BaseError(Exception):
    """
    Base package error. All package errors are inherited from it.
    """


class IdentityError(BaseError):
    """
    Raised when a batch requests/responses identifiers are not unique or missing.
    """


class DeserializationError(BaseError, ValueError):
    """
    Request/response deserializatoin error.
    Raised when request/response json has incorrect format.
    """


class JsonRpcErrorMeta(type):
    """
    Builds a mapping from an error code number to an error class
        inherited from a :py:class:`pjrpc.common.exceptions.JsonRpcError`.
    """


class JsonRpcError(BaseError, metaclass=JsonRpcErrorMeta):
    """
    `JSON-RPC <https://www.jsonrpc.org>`_ protocol error.
    All JSON-RPC protocol errors are inherited from it.

    Args:
        code: number that indicates the error type
        message: short description of the error
        data: value that contains additional information about the error. May be omitted.
    """

    code: int = None  # type: ignore[assignment]
    message: str = None  # type: ignore[assignment]
    __errors_mapping__: ClassVar[dict[int, type[JsonRpcError]]] = {}

    @classmethod
    def from_json(cls, json_data: Any) -> JsonRpcError:
        """
        Deserializes an error from json data. If data format is not correct a
        ValueError is raised.
        """

        try:
            if not isinstance(json_data, dict):
                raise DeserializationError("data must be of type dict")

            code = json_data["code"]
            if not isinstance(code, int):
                raise DeserializationError(
                    "field 'code' must be of type integer")

            message = json_data["message"]
            if not isinstance(message, str):
                raise DeserializationError(
                    "field 'message' must be of type string")

            error_class = cls.get_error_cls(code, cls)

            return error_class(code, message, json_data.get("data", NOT_SET))
        except KeyError as e:
            raise DeserializationError(f"required field {e} not found") from e

    @classmethod
    def get_error_cls(
        cls, code: int, default: type[JsonRpcError]
    ) -> type[JsonRpcError]:
        return cls.__errors_mapping__.get(code, default)

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if hasattr(cls, "code") and cls.code is not None:
            cls.__errors_mapping__[cls.code] = cls

    def __init__(
        self,
        code: int | None = None,
        message: str | None = None,
        data: Any = NOT_SET,
    ):
        assert code or self.code, "code is not provided"
        assert message or self.message, "message is not provided"

        self.code = code or self.code
        self.message = message or self.message
        self.data = data

        super().__init__(code, message)

    def __str__(self) -> str:
        return "({code}) {message}".format(code=self.code, message=self.message)

    def __repr__(self) -> str:
        return "{class_name}(code={code}, message={message}, data={data})".format(
            class_name=self.__class__.__name__,
            code=repr(self.code),
            message=repr(self.message),
            data=repr(self.data),
        )

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, JsonRpcError):
            return NotImplemented

        return (self.code, self.message, self.data) == (
            other.code,
            other.message,
            other.data,
        )

    def to_json(self) -> dict[str, Any]:
        """
        Serializes the error to a dict.

        :returns: serialized error
        """

        json = {
            "code": self.code,
            "message": self.message,
        }
        if self.data is not NOT_SET:
            json.update(data=self.data)

        return json


class ClientError(JsonRpcError):
    """
    Raised when a client sent an incorrect request.
    """


class ParseError(ClientError):
    """
    Invalid JSON was received by the server.
    An error occurred on the server while parsing the JSON text.
    """

    code: int = -32700
    message: str = "Parse error"


class InvalidRequestError(ClientError):
    """
    The JSON sent is not a valid request object.
    """

    code: int = -32600
    message: str = "Invalid Request"


class MethodNotFoundError(ClientError):
    """
    The method does not exist / is not available.
    """

    code: int = -32601
    message: str = "Method not found"


class InvalidParamsError(ClientError):
    """
    Invalid method parameter(s).
    """

    code: int = -32602
    message: str = "Invalid params"


class InternalError(JsonRpcError):
    """
    Internal JSON-RPC error.
    """

    code: int = -32603
    message: str = "Internal error"


class ServerError(JsonRpcError):
    """
    Reserved for implementation-defined server-errors.
    Codes from -32000 to -32099.
    """

    code: int = -32000
    message: str = "Server error"
