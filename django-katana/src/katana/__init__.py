"""Django Katana - Fast Django RPC framework"""

__version__ = "0.1.0"


from pydantic import Field

from ninja.files import UploadedFile
from ninja.filter_schema import FilterSchema
from ninja.openapi.docs import Redoc, Swagger
from ninja.orm import ModelSchema
from ninja.params import (
    Body,
    BodyEx,
    Cookie,
    CookieEx,
    File,
    FileEx,
    Form,
    FormEx,
    Header,
    HeaderEx,
    P,
    Path,
    PathEx,
    Query,
    QueryEx,
)
from ninja.patch_dict import PatchDict
from ninja.schema import Schema

from .core import KatanaRPC
from .router import Router
from .decorators import example

from . import errors
from .errors import JsonRpcError


__all__ = [
    "Field",
    "UploadedFile",
    "KatanaRPC",
    "Body",
    "Cookie",
    "File",
    "Form",
    "Header",
    "Path",
    "Query",
    "BodyEx",
    "CookieEx",
    "FileEx",
    "FormEx",
    "HeaderEx",
    "PathEx",
    "QueryEx",
    "Router",
    "P",
    "Schema",
    "ModelSchema",
    "FilterSchema",
    "Swagger",
    "Redoc",
    "PatchDict",
    "JsonRpcError",
    "example",
    "errors",
]
