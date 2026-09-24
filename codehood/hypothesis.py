"""
Hypothesis strategies that generate documents conforming to an OpenAPI schema.

`tests/test_api_generate.py` proves the generator emits runnable code against
a handful of hand-written fixtures. It cannot prove the generated models
accept every document the server can actually send, since every fixture is
one a human invented. These strategies read the server's own OpenAPI
document and draw JSON that the document says is valid, so a property test
can check the invariant directly: anything the spec permits, the generated
model must accept.

Only the JSON Schema subset that appears in the server's document is
supported -- see `dev/specs/to-review/api-hypothesis-strategies.md` for the
survey. A keyword outside that subset (`allOf`, `not`, ...) raises
`UnsupportedSchemaError` rather than silently generating something the spec
doesn't actually permit.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC
from typing import Any

from hypothesis import strategies as st

from .api.generate import UnsupportedSchemaError
from .api.openapi import JSONSchema, OpenAPISpec, load_openapi

type JSON = dict[str, Any] | list[Any] | str | int | float | bool | None

__all__ = [
    "JSON",
    "json_schema_documents",
    "openapi_endpoint_documents",
    "openapi_response_documents",
]


def json_schema_documents(
    schema: JSONSchema, spec: OpenAPISpec | None = None
) -> st.SearchStrategy[JSON]:
    """
    Build a strategy that draws JSON documents conforming to `schema`.

    Args:
        schema: A JSON Schema node (OpenAPI's dialect: `nullable: true`
            rather than a `null` member of `type`).
        spec: The document `schema` came from, needed only to resolve a
            `$ref`. Pass `None` when `schema` is known not to contain one.

    Returns:
        A strategy drawing values that conform to `schema`.

    Raises:
        ValueError: `schema` contains a `$ref` but `spec` is `None`.
        UnsupportedSchemaError: `schema` uses a JSON Schema feature outside
            the surveyed subset (`allOf`, `not`, list-valued `type`,
            ...).
    """
    if "$ref" in schema:
        if spec is None:
            raise ValueError(
                f"schema contains $ref {schema['$ref']!r} but no spec was given "
                "to resolve it against"
            )
        _name, resolved = spec.resolve(schema)
        return json_schema_documents(resolved, spec)

    if "allOf" in schema or "not" in schema or isinstance(schema.get("type"), list):
        raise UnsupportedSchemaError(
            f"cannot build a strategy for this schema yet:\n{schema!r}"
        )

    enum_values = schema.get("enum")
    if enum_values is not None:
        strategy = st.sampled_from(enum_values)
    elif members := (schema.get("anyOf") or schema.get("oneOf")):
        # `oneOf` draws the same way as `anyOf`: every union in this
        # document is discriminated by a single-valued `type` enum, so a
        # document valid against one member is valid against exactly one.
        strategy = st.one_of(
            *(json_schema_documents(member, spec) for member in members)
        )
    else:
        strategy = _leaf_strategy(schema, spec)

    if schema.get("nullable"):
        strategy = st.none() | strategy
    return strategy


def openapi_endpoint_documents(
    endpoint: str, openapi_spec: OpenAPISpec | Mapping[str, Any]
) -> st.SearchStrategy[JSON]:
    """
    Build a strategy for the JSON request body of one operation.

    Args:
        endpoint: The operation's `operationId`, the same key `ENDPOINTS`
            and `codehood api` use.
        openapi_spec: The document the operation is defined in, either
            already parsed or as a raw dict (which goes through
            `load_openapi`).

    Returns:
        A strategy drawing request bodies the operation's spec permits.

    Raises:
        KeyError: `endpoint` is not an operation in `openapi_spec`.
        ValueError: the operation has no `requestBody`.
    """
    spec = _as_spec(openapi_spec)
    operation = spec.operations()[endpoint].operation
    if operation.request_body is None:
        raise ValueError(f"{endpoint!r} has no requestBody to generate documents for")
    media = operation.request_body.content.get("application/json")
    if media is None:
        raise ValueError(f"{endpoint!r} has no application/json requestBody")
    return json_schema_documents(media.content_schema, spec)


def openapi_response_documents(
    endpoint: str, openapi_spec: OpenAPISpec | Mapping[str, Any], status: int = 200
) -> st.SearchStrategy[JSON]:
    """
    Build a strategy for one operation's JSON response body.

    Args:
        endpoint: The operation's `operationId`.
        openapi_spec: The document the operation is defined in, either
            already parsed or as a raw dict.
        status: The HTTP status whose response to generate documents for.

    Returns:
        A strategy drawing response bodies the operation's spec permits.

    Raises:
        KeyError: `endpoint` is not an operation, or has no response
            documented for `status`.
        ValueError: the response has no `application/json` content.
    """
    spec = _as_spec(openapi_spec)
    operation = spec.operations()[endpoint].operation
    response = operation.responses[str(status)]
    media = response.content.get("application/json")
    if media is None:
        raise ValueError(
            f"{endpoint!r}'s {status} response has no application/json content"
        )
    return json_schema_documents(media.content_schema, spec)


#
# INTERNAL
#
def _as_spec(openapi_spec: OpenAPISpec | Mapping[str, Any]) -> OpenAPISpec:
    """
    Accept either a parsed `OpenAPISpec` or the raw dict it comes from.
    """
    if isinstance(openapi_spec, OpenAPISpec):
        return openapi_spec
    return load_openapi(dict(openapi_spec))


def _leaf_strategy(
    schema: JSONSchema, spec: OpenAPISpec | None
) -> st.SearchStrategy[JSON]:
    """
    A strategy for a schema known not to be a `$ref`, `enum`, `anyOf`, or
    `oneOf` wrapper -- dispatches on `type`, and free-form values when there is
    none.
    """
    schema_type = schema.get("type")
    if schema_type == "string":
        return _string_strategy(schema)
    if schema_type == "integer":
        return _integer_strategy(schema)
    if schema_type == "number":
        return _number_strategy(schema)
    if schema_type == "boolean":
        return st.booleans()
    if schema_type == "array":
        items = schema.get("items", {})
        return st.lists(json_schema_documents(items, spec), max_size=3)
    if schema_type == "object":
        return _object_strategy(schema, spec)

    # No `type` and none of the keywords handled above: a free-form leaf,
    # the only shape this document uses for "anything goes".
    return st.none() | st.booleans() | st.integers() | st.text()


def _string_strategy(schema: JSONSchema) -> st.SearchStrategy[str]:
    """
    `pattern` wins over `format`, since a pattern pins the exact shape a
    `format` would otherwise only approximate (see `login`'s username
    branch).
    """
    pattern = schema.get("pattern")
    if pattern is not None:
        # `from_regex` is overloaded on `str` versus `bytes`, and a schema's
        # values are untyped, so the `str` overload has to be picked here.
        return st.from_regex(str(pattern), fullmatch=True)

    string_format = schema.get("format")
    if string_format == "date-time":
        return st.datetimes(timezones=st.just(UTC)).map(lambda value: value.isoformat())
    if string_format == "email":
        return st.emails()
    if string_format == "binary":
        # The server types `Buffer` as a plain string and the generated
        # model is `str`; a real byte stream is not what round-trips here.
        return _bounded_text(schema)

    return _bounded_text(schema)


def _bounded_text(schema: JSONSchema) -> st.SearchStrategy[str]:
    return st.text(
        min_size=schema.get("minLength", 0),
        max_size=schema.get("maxLength"),
    )


def _integer_strategy(schema: JSONSchema) -> st.SearchStrategy[int]:
    minimum = schema.get("minimum")
    maximum = schema.get("maximum")
    # OAS 3.0 spells `exclusiveMinimum`/`exclusiveMaximum` as booleans
    # modifying `minimum`/`maximum`, not as standalone bounds.
    if schema.get("exclusiveMinimum") and minimum is not None:
        minimum += 1
    if schema.get("exclusiveMaximum") and maximum is not None:
        maximum -= 1
    return st.integers(min_value=minimum, max_value=maximum)


def _number_strategy(schema: JSONSchema) -> st.SearchStrategy[float]:
    minimum = schema.get("minimum")
    maximum = schema.get("maximum")
    exclude_min = bool(schema.get("exclusiveMinimum")) and minimum is not None
    exclude_max = bool(schema.get("exclusiveMaximum")) and maximum is not None
    return st.floats(
        min_value=minimum,
        max_value=maximum,
        exclude_min=exclude_min,
        exclude_max=exclude_max,
        allow_nan=False,
        allow_infinity=False,
    )


def _object_strategy(
    schema: JSONSchema, spec: OpenAPISpec | None
) -> st.SearchStrategy[dict[str, JSON]]:
    """
    Every `required` property always present, every optional property
    present or absent -- never an extra key, `additionalProperties: false`
    or not, since this strategy models valid requests and an unknown key is
    a server-side rejection, not a document the spec permits.
    """
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    fields: dict[str, st.SearchStrategy[JSON]] = {}
    optional: dict[str, st.SearchStrategy[JSON]] = {}
    for name, property_schema in properties.items():
        strategy = json_schema_documents(property_schema, spec)
        if name in required:
            fields[name] = strategy
        else:
            optional[name] = strategy

    return st.fixed_dictionaries(fields, optional=optional)
