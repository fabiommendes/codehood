# Hypothesis strategies for OpenAPI documents

## Why

`tests/test_api_generate.py` proves the generator emits *runnable* code: a
handful of hand-written fixtures go in, the source is exec'd, two calls run
through a mock transport. What it cannot prove is that the emitted models
actually accept the documents the server says it will send. Every fixture is
one we invented, so a shape the server uses but we never thought to type out
is invisible to the suite.

A Hypothesis strategy that reads the server's own OpenAPI document and
produces conforming JSON closes that gap. The invariant is worth stating
plainly: **anything the spec permits, the generated model must accept.** One
property test over all 23 registered operations replaces an unbounded number
of fixtures we would otherwise have to guess at.

## Scope

Only the JSON Schema features that appear in `localhost:4321/openapi.json`
(snapshot: `resources/openapi/codehood.json`). Surveyed on 2026-09-04:

| Feature                                                      | Occurrences | Notes                                                        |
| :----------------------------------------------------------- | ----------: | :----------------------------------------------------------- |
| `type: string / number / integer / object / array / boolean` |         103 | no `null` type                                               |
| `format: date-time`                                          |         122 | must parse as a pydantic `datetime`                          |
| `format: email`                                              |           7 |                                                              |
| `format: binary`                                             |           1 | the `Buffer` schema, `createFile.bytes`                      |
| `nullable: true`                                             |          90 | OAS 3.0 spelling, never `type: [x, "null"]`                  |
| `minLength`                                                  |         117 | always `1`                                                   |
| `pattern`                                                    |           1 | `^[a-z0-9][a-z0-9-]{1,30}$` (the username branch of `login`) |
| `enum`                                                       |          38 | 8 distinct, all strings                                      |
| `minimum` / `maximum` / `exclusiveMinimum`                   |           4 | `exclusiveMinimum` is the OAS 3.0 *boolean* flag             |
| `anyOf`                                                      |           1 | `LoginRequest.login`: email or username                      |
| `$ref`                                                       |          15 | always `#/components/schemas/<Name>`                         |
| `additionalProperties: false`                                |           1 | `updateUser`                                                 |
| `required` / `properties` / `items`                          |        many |                                                              |

Absent from the document and therefore **out of scope**: `allOf`, `oneOf`,
`not`, `const`, `default`, `discriminator`, `multipleOf`, `uniqueItems`,
`minItems`/`maxItems`, tuple-form `items`, non-JSON media types.

Hitting an unsupported keyword must raise `UnsupportedSchemaError` (reuse the
one in `api.generate`) rather than quietly generating something wrong. A
silent wrong document turns a property test into a liar.

## Public API

`src/codehood_cli/hypothesis.py`, a public module. Three entry points, one
shared recursive core:

```python
def json_schema_documents(schema: JSONSchema, spec: OpenAPISpec | None = None) -> SearchStrategy[JSON]
def openapi_endpoint_documents(endpoint: str, openapi_spec: OpenAPISpec | Mapping[str, Any]) -> SearchStrategy[JSON]
def openapi_response_documents(endpoint: str, openapi_spec: ..., status: int = 200) -> SearchStrategy[JSON]
```

`endpoint` is an `operationId`, the same key `ENDPOINTS` and `codehood api`
use. `openapi_spec` accepts either a raw dict or an already-parsed
`OpenAPISpec`; the raw form goes through `load_openapi`, so `$ref` resolution
reuses `OpenAPISpec.resolve` instead of a second ref resolver.

`json_schema_documents` needs `spec` only when the schema contains a `$ref`;
passing `None` and hitting one is a `ValueError`.

An operation with no `requestBody` raises `ValueError` from
`openapi_endpoint_documents`. Returning `st.none()` would let a test loop
silently cover nothing, which is the failure mode this whole spec exists to
prevent.

## Generation rules

Per keyword, in the order the builder should check them:

* `$ref` -> resolve through the spec, recurse. Recursive schemas do not occur
  in this document; if one appears, Python's recursion limit is a loud enough
  failure.
* `enum` -> `sampled_from`. Checked before `type`, since an enum pins the
  value set regardless of the declared type.
* `anyOf` -> `one_of` over the branches.
* `nullable: true` -> `none() | <base>`, applied last so it composes with
  everything above.
* `string` -> `text()` honouring `minLength`/`maxLength`, then by `format`:
  `date-time` from `datetimes(timezones=just(UTC))` rendered with
  `isoformat()`, `email` from `emails()`, `binary` from `text()` (the server
  types `Buffer` as a plain string and the generated model is `str`).
  `pattern` wins over `format` and goes through `from_regex(fullmatch=True)`.
* `integer` / `number` -> `integers()` / `floats(allow_nan=False,
  allow_infinity=False)` with `minimum`/`maximum` applied, and
  `exclusiveMinimum: true` narrowing the bound by one (integers) or via
  `exclude_min` (floats). NaN and infinity are excluded because the documents
  must survive a `json.dumps` round trip.
* `boolean` -> `booleans()`.
* `array` -> `lists(items, max_size=3)`. Small on purpose. A 200-element list
  costs shrink time and proves nothing a 3-element one does not.
* `object` -> every `required` property always present, every optional
  property present or absent. Extra keys are never generated, whether or not
  `additionalProperties: false` is written: this strategy models *valid
  requests*, and an unknown key is a server-side rejection, not a document
  the spec permits. `additionalProperties` as a schema does not occur here
  and is out of scope.
* A schema with no `type` and no other keyword -> `none() | booleans() |
  integers() | text()`, no containers. Free-form values exist in this
  document only as leaves.

## Proving it works

`tests/test_hypothesis.py`:

1. **The invariant, against the real snapshot.** For every operation in
   `ENDPOINTS`, read the generated function's `body` and return annotations
   with `typing.get_type_hints` (no name guessing) and, under `@given`,
   validate a generated document against them.

   Validation alone is not enough, and this is worth being blunt about:
   pydantic ignores keys it has no field for, so a model that dropped
   `_count` entirely accepts every document the correct one does. Measured,
   not assumed: a `Course` with its `count` field deleted passed 20/20
   draws. The test therefore dumps the model back out with
   `by_alias=True` and asserts every key of the generated document is still
   present, recursively through nested objects and lists. That version does
   fail on the deleted field, naming `_count`.
2. **JSON round trip.** Every generated document survives
   `json.loads(json.dumps(doc))` unchanged. Guards against `datetime`,
   `Decimal`, NaN, or bytes leaking out of the strategy.
3. **Per-keyword unit tests**, each on a small inline schema: enum values are
   drawn from the enum; `nullable` produces both `None` and non-`None` across
   a run; `pattern` output full-matches the regex; `minLength` is respected;
   `minimum`/`exclusiveMinimum` bounds hold; required keys are always present
   and no key outside `properties` ever appears; `$ref` resolves; `anyOf`
   yields values from more than one branch.
4. **Unsupported keywords raise.** `allOf` and `oneOf` each raise
   `UnsupportedSchemaError`.

Use `@settings(max_examples=...)` sparingly. The default is fine except for
the whole-spec invariant test, where a lower count keeps the suite under a
second or two.
