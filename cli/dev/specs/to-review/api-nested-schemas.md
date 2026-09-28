# Nested and composite schemas in `api.generate`

## Problem

`python -m codehood_cli.api.generate` fails against the current server:

```
UnsupportedSchemaError: cannot map schema to a Python type yet:
{"type": "object", "properties": {"disciplineSlug": ..., "startAt": {"type": "string", "nullable": true, ...}}, ...}
```

The `api.md` spec deliberately scoped the type mapper to "what the server
currently emits": flat `$ref`ed objects of primitives, enums and arrays.
The server has since grown the CRUD surface (`course`, `discipline`,
`edition`, `user`), and every one of those operations uses **inline**
`object` schemas -- for the request body, for the 200 response, and nested
one level deeper inside those (`readCourse` -> `discipline`, `edition`,
`instructor`, `enrollments[]`). `LoginRequest.login` is an `anyOf` of two
strings. Several fields are `nullable: true`. None of that generates today.

This spec lifts the type mapper to cover exactly the JSON Schema the server
emits now, keeping the "fail loudly rather than emit `Any`" rule for
everything else.

## What the current spec actually contains

Measured over `resources/openapi/codehood.json` (refreshed snapshot of
the live document):

- 90 `type: object` schemas with `properties`, mostly inline.
- 90 `nullable: true` fields.
- 1 `anyOf` (`LoginRequest.login`: email-formatted string or slug-patterned
  string).
- 1 `additionalProperties` (`updateUser`'s body, `false`, alongside
  `properties`).
- 0 `oneOf`, `allOf`, `not`, or list-valued `type`.
- Inline objects nest at most 2 levels deep, including through `array`
  items (`listCourse` -> array of course objects -> `discipline` object).
- All error responses are `$ref`s (`HealthError`); only success responses
  and request bodies are inline.

## Design

### Inline objects become top-level models, linked by name

An inline `object` schema with `properties` becomes a real class rather
than `dict[str, Any]` -- the whole point of the generated module is that a
caller gets typed attributes.

Every such class is emitted at **module top level**, and a field that holds
one refers to it by name, exactly as a `$ref`ed schema would. The server
inlines what are really shared entities; the generator un-inlines them.

**Structurally identical schemas become one class.** A pre-pass walks every
operation reachable from `ENDPOINTS`, collects each inline object schema,
and keys it by its *structure* (`shape_id`) -- what the generator renders,
with the documentation keys it drops left out. `readCourse`'s response,
`listCourse`'s array item, and `createCourse`/`updateCourse`'s responses
are one schema, and `discipline` nested inside all of them is the same
schema again as `readDiscipline`'s whole response.

**A shape identical to a component schema *is* that component.** The server
inlines on the read paths what it `$ref`s on the create path, so a shape
whose `shape_id` matches a component's takes that component's class name
and renders once. `readExam` and `listExam` speak `Exam`, not a site-named
twin of it.

**Naming.** Otherwise, each site a shape appears at proposes a candidate
name; the shape takes the best one, by tier, alphabetically within a tier:

1. **A discriminated-union tag** -- `Data` + `MD` -> `DataMd`.
2. **A projection of a component schema** -- a strict property subset of a
   component, with equal shapes on every shared property, reached through a
   property named after that component, is `<Component>At<Entity>`:
   `listCalendarEvent`'s embedded `{slug, day, start, duration}` is
   `TimeSlotAtCalendarEvent`. The qualifier is the entity the operation is
   about, never the operation id -- the verb and the list-ness are noise.
3. **A property name it appears under** -- `Pascal(property)`, so the
   `discipline` field's shape is `Discipline`. A shape used as a field
   somewhere has already been given a name by the server; use it.
4. **The entity name of a CRUD operation whose 2xx response it is** --
   `readCourse`/`listCourse`/... -> `Course`. The generator already knows
   this verb list; it is `_crud`'s, not a guess about English.
5. **The site itself** -- `<Op>Request`, `<Op>Response`,
   `<Op>ResponseItem`, `<Op>Error<Status>`.

An array of inline objects names its item type `<candidate>Item`
(`enrollments` -> `EnrollmentsItem`) -- except for an entity name, which
already describes the item rather than the list: `listCourse` returns
`list[Course]`, not `list[CourseItem]`.

A name is only taken bare when exactly one shape proposes it and no
component schema owns it. A shape whose every candidate is contested is
named `<Owner><Best>` after the object that holds it, outermost owner
first. A numeric suffix is the last resort, not the scheme -- it is
reachable only for two untagged union members sharing one owner and one
base name, which nothing in today's spec has.

This replaces an earlier nested-class design (`ReadCourseResponse.Discipline`).
Nested classes made every occurrence of `discipline` a *different* type,
so a `Discipline` read from a course and one read from `readDiscipline`
could not be passed to the same function -- and the deeper a shape sat,
the longer its path. Flat classes keyed by structure give one name per
real thing.

### `nullable`, `anyOf`/`oneOf`, and unions

- `nullable: true` maps to `T | None`. It is independent of `required`: a
  required nullable field is `T | None` with no default; an optional one is
  `T | None = None`. Composing the two must not emit `str | None | None`,
  so union members are deduplicated, preserving first-seen order.
- `anyOf`/`oneOf` map to the union of their members' types, deduplicated
  the same way -- `LoginRequest.login`'s two strings collapse to `str`, not
  `str | str`. A `{"type": "null"}` member contributes `None`.
- `allOf` still raises. Merging subschemas is a real design question
  (conflicting `required`, overlapping `properties`) and nothing in the
  spec needs it.

### Function arguments are snake_case

A generated function's parameters take Python names -- `list_course(...,
instructor_username=None)`, not `instructorUsername`. The wire name is
untouched: it stays the key in `params={'instructorUsername': ...}` and
the `.format()` keyword for a path placeholder, so converting the argument
can never change the request. An argument that would collide with the
`client` or `body` keywords `render_function` adds itself, or with a
Python keyword, gets a trailing underscore.

`codehood api`'s call form keeps showing the server's own names, and maps
them to the argument names when it invokes the function.

### Parsing a response body

A generated model validates itself (`Course.model_validate(...)`), but a
response type is not always a model: `list[Course]` is a
`types.GenericAlias` and `dict[str, Any]` a builtin, and neither has
`model_validate`. Anything that is not a bare model name is parsed with
`TypeAdapter(<type>).validate_python(...)` instead.

A *documented error* must still be an object schema -- the exception
machinery wraps one `Payload` model -- so an error response that maps to
anything else raises rather than generating a broken `raise`.

### `additionalProperties`

- With `properties` present, it is ignored (`updateUser`'s `false` adds
  nothing a generated model doesn't already say).
- With no `properties` and a schema value, the type is `dict[str, T]`.
- With no `properties` and `true`/absent, `dict[str, Any]`.

### Enums

`enum` currently only produces a `Literal` for `type: string`. It becomes
`Literal[...]` for any enum whose values are all `str`/`int`/`bool`/`None`
-- the same rule, no longer arbitrarily string-only.

### What still raises `UnsupportedSchemaError`

`allOf`, `not`, list-valued `type`, and any node with no `type`, no `$ref`,
and no `anyOf`/`oneOf`. The error keeps naming the offending schema.

### Deliberately out of scope

- **`format` -> richer Python types.** `format: date-time` stays `str`, as
  today. Mapping it to `datetime` changes the type of every existing
  timestamp field and is a separate, larger decision about what the CLI
  hands its callers.
- **Model field-name conversion.** A *model's* `disciplineSlug` stays
  `disciplineSlug`. Function *arguments* are snake_cased (see below), but
  doing the same to every model field means an alias on every field of
  every model, and is its own change.
- **Fuzzy deduplication.** Only *structurally identical* schemas merge --
  same fields, in the same order, with the same types, optionality and
  aliases, ignoring the documentation keys the generator never emits
  (`description`, `minimum`, `nullable` on the object itself). Two shapes
  that differ by one optional field stay two classes; guessing that they
  are "the same really" is not the generator's call. (Superseded the
  original byte-identical rule: it split the exam's `duration` from the
  time slot's over a `nullable` flag neither class carries.)

## Proving it works

- **The real spec generates.** `resources/openapi/codehood.json`,
  refreshed from the live server, generates for all 23 entries of
  `ENDPOINTS` and the emitted source `exec`s cleanly. This is the
  regression that this whole spec exists for.
- **Inline response objects become named models** -- `readCourse` returns
  `Course`, and it has the fields the spec declares.
- **Nested objects become their own top-level classes**, and a generated
  `Course.model_validate(...)` on a realistic payload round-trips into
  `.discipline.slug` and `.enrollments[0].userId`, not into dicts -- with
  `Discipline` and `EnrollmentsItem` reachable at module level.
- **One class per distinct shape** -- `readCourse` and `listCourse` return
  the same `Course` class, not two identical ones, and `listCourse`
  validates a two-element payload.
- **Inline array responses** -- `listCourse` returns `list[Course]`.
- **Inline request bodies** -- `createCourse` takes
  `body: CreateCourseRequest`.
- **`nullable` fields** accept `None` and typed values, required and
  optional alike, with no `None | None` in the emitted annotation.
- **`anyOf` collapses** -- `login`'s body field is annotated `str`.
- **A free-form object** (no `properties`) becomes `dict[str, T]` when
  `additionalProperties` names a schema, `dict[str, Any]` otherwise.
- **Query and path parameters are snake_cased in the signature** while the
  request still uses the server's names, for both `params={...}` keys and
  path `.format()` substitution.
- **A wire name Python can't carry** (`_count`, which pydantic would treat
  as a private attribute and silently drop) becomes a plain field with
  `Field(alias=...)`, and round-trips in both directions.
- **A list response parses at runtime**, proven by calling the generated
  function against a fake transport rather than only `exec`ing it -- the
  naive `list[Course].model_validate(...)` raises `AttributeError` on the
  first request, which an import-only test never sees. Same for a
  `dict[str, Any]` response.
- **`allOf` still raises** `UnsupportedSchemaError` naming the schema.
- **Nothing regresses** for `$ref`ed schemas, exceptions, `auth_headers`,
  or the existing fixture-spec tests.
