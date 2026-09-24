"""
Typed access to a Codehood server's OpenAPI document.

Models only what `codehood api` and `api.generate` actually read: each
operation's identity, summary, parameters, request/response bodies, and
declared security, plus the named schemas in `components.schemas` those
bodies reference. A schema's
own shape (`properties`, `enum`, `$ref`, ...) is kept as a raw dict rather
than modeled field-by-field -- `api.generate`'s type mapper is what
interprets it, and it only needs to understand the JSON Schema subset the
server actually emits.
"""

from __future__ import annotations

from typing import Any, Literal, NamedTuple

from pydantic import Field

from ..models.base import Model

type JSONSchema = dict[str, Any]

#: One entry of a `security` array: scheme name -> required scopes (empty
#: for an API-key-style scheme like `BearerAuth`, non-empty for OAuth2).
type SecurityRequirement = dict[str, list[str]]


class MediaType(Model):
    content_schema: JSONSchema = Field(alias="schema", default_factory=dict)


class RequestBody(Model):
    content: dict[str, MediaType] = Field(default_factory=dict)
    required: bool = False


class Response(Model):
    description: str = ""
    content: dict[str, MediaType] = Field(default_factory=dict)


class Parameter(Model):
    name: str
    location: Literal["path", "query", "header", "cookie"] = Field(alias="in")
    required: bool = False
    content_schema: JSONSchema = Field(alias="schema", default_factory=dict)


class Operation(Model):
    operation_id: str = Field(alias="operationId")
    summary: str = ""
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    parameters: list[Parameter] = Field(default_factory=list)
    request_body: RequestBody | None = Field(alias="requestBody", default=None)
    responses: dict[str, Response] = Field(default_factory=dict)
    #: `None` means "use the document's default security" (see
    #: `OpenAPISpec.requires_auth`); `[]` is an explicit override to none.
    security: list[SecurityRequirement] | None = None


class Info(Model):
    title: str
    version: str
    description: str = ""


class Components(Model):
    schemas: dict[str, JSONSchema] = Field(default_factory=dict)


class OpenAPISpec(Model):
    openapi: str
    info: Info
    components: Components = Field(default_factory=Components)
    paths: dict[str, dict[str, Operation]] = Field(default_factory=dict)
    #: The document-wide default security requirement, in effect for any
    #: operation that doesn't declare its own `security`.
    security: list[SecurityRequirement] = Field(default_factory=list)

    def requires_auth(self, operation: Operation) -> bool:
        """
        Whether calling `operation` needs credentials.

        An operation's own `security` overrides the document's default when
        present (even an explicit `[]`, meaning "this one doesn't need it");
        otherwise the document's default applies.
        """
        security = (
            operation.security if operation.security is not None else self.security
        )
        return bool(security)

    def operations(self) -> dict[str, Endpoint]:
        """
        Flatten `paths` into `operationId -> Endpoint`.

        Every schema in the document assigns each operation a unique
        `operationId`, which is what `ENDPOINTS` (in `api.generate`) and
        `codehood api`'s listing key off -- not `(method, path)`, since a
        server-side rename would silently break a hand-written pair but
        leaves the id alone.
        """
        return {
            operation.operation_id: Endpoint(method.upper(), path, operation)
            for path, methods in self.paths.items()
            for method, operation in methods.items()
        }

    def resolve(self, schema: JSONSchema) -> tuple[str, JSONSchema]:
        """
        Follow a `$ref` to its schema in `components.schemas`.

        Returns the schema's name and its body. Raises `KeyError` if `schema`
        is not a `$ref`, or points at a name `components.schemas` doesn't
        have -- both are a malformed document, not a recoverable case.
        """
        ref = schema["$ref"]
        name = ref.rsplit("/", 1)[-1]
        return name, self.components.schemas[name]


class Endpoint(NamedTuple):
    method: str
    path: str
    operation: Operation


def load_openapi(data: dict[str, Any]) -> OpenAPISpec:
    """
    Parse a raw OpenAPI document into an `OpenAPISpec`.
    """
    return OpenAPISpec.model_validate(data)
