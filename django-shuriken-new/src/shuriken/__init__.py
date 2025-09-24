from ninja.errors import ValidationError

from .api import ShurikenAPI, delete, get, patch, post, put
from .controllers.base import BaseController
from .controllers.rest import RestController

__version__ = "0.1.0"

__all__ = [
    "ShurikenAPI",
    "BaseController",
    "RestController",
    "get",
    "post",
    "delete",
    "patch",
    "put",
    "api_error",
]


def api_error(error, message=None, fields=(), /, **kwargs) -> ValidationError:
    """
    Used to construct errors for ValidationError in an uniform way.
    """
    kwargs["error"] = error
    kwargs["message"] = message or error
    if fields is None:
        kwargs["fields"] = []
        return ValidationError([kwargs])
    return ValidationError([kwargs, *fields])
