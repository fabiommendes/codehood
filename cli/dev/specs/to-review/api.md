# `codehood api`

Roadmap 0.1.0 lists it as "interactive exploration of the REST API/debugging,"
sitting between `init` and `push`. That ordering is not an accident: `push`
needs a typed, validated way to call the server, and this is where that layer
gets built — the browsing command is really the visible half of a two-part
feature, the other half being the internal `src/api/` client every future
command (`push`, `roster`, `login`) will call into.

## Scope

- `codehood api`: a Textual screen listing the endpoints the CLI knows about,
  reading their live shape (summary, parameters, request/response schemas)
  straight from a server's `openapi.json` — never from an assumption baked
  into Python.
- Calling an endpoint from that same screen: a form built from the request
  body's schema when it has one, dispatched to the generated function, result
  or typed exception shown in place — gated by the spec's own declared
  `security`, not by whether the CLI happens to hold a key yet.
- `python -m codehood_cli.api.generate`: a codegen CLI that reads an
  `openapi.json` (local file or fetched over HTTP) and writes
  `src/codehood_cli/api/generated.py` — typed functions, request/response
  models, and typed exceptions, one per endpoint listed in the `ENDPOINTS`
  registry.
- `src/codehood_cli/api/base.py`: the shared `httpx` client and the
  `CodehoodAPIError` exception hierarchy every generated function uses.
- `src/codehood_cli/api/openapi.py`: the typed model of an OpenAPI document
  both the browser and the generator parse it through.
- A `taskipy` task to run codegen.
- `tests/test_api_integration.py`: real HTTP calls against a running
  Codehood server (`CODEHOOD_SERVER`, default `http://localhost:4321`), kept
  separate from the rest of the suite and skipped unless explicitly asked
  for.

Out of scope, and why, in the closing section: calling an endpoint that
requires auth (there is still nowhere to get a key from), and full JSON
Schema support (`anyOf`/`oneOf`/`allOf`, inline object schemas).

## Design decisions

### Calling is gated by the spec's own `security`, not by whether we have a key

The first draft of this spec split the work into "browsing now" and "calling
later," reasoning that calling needs an API key and there is nowhere to get
one from yet (`codehood login` is an unimplemented stub, and `cli/init.py`
already has `_default_server`/`_has_credentials` as explicit hooks for a
credentials store that does not exist). That reasoning assumed every call
needs a key. It doesn't: both endpoints currently in `ENDPOINTS` declare
`"security": []` in the spec, overriding the document's default
`[{"BearerAuth": []}]` — `getHealth` and `cliLogin` are unauthenticated by
design (the health check has to work before anything can prove who it is, and
you don't have a key yet when logging in). Nothing about "no credentials
store exists" blocks calling either of them.

So calling ships now, gated on the same fact the server itself publishes:
`Operation.security` (or the document's default, when an operation doesn't
override it). An endpoint whose effective security is non-empty refuses with
a clear message ("this endpoint requires authentication, which `codehood
login` doesn't support yet") instead of attempting a request that would just
fail server-side — building the credentials store itself is still the auth
spec's job, not this one's, the same trap `init.md` names for its own
out-of-scope items. When `push` or `roster` add an authenticated operationId
to `ENDPOINTS` later, this is the gate that will need the auth spec to have
landed; today's two endpoints don't wait on it.

### A modal form when there's something to fill in, an immediate call when there isn't

`getHealth` takes nothing, so selecting it and pressing enter calls it
immediately. `cliLogin` takes a request body, so pressing enter opens a modal
with one `Input` per field of the resolved request-body schema, in the order
the schema declares them, required fields marked and enforced before submit.
A field whose name contains `password` is masked (`Input(password=True)`) --
a name-based heuristic rather than a schema-driven one, since JSON Schema has
no standard way to say "this string is a secret" and `CliLoginRequest`'s
`password` field is a plain `string` with a `minLength`, nothing more.

Query and path parameters get the same modal treatment when an operation has
them, even though neither current endpoint does -- the form is built from
`operation.parameters` plus `operation.request_body` generically, not
specialized to `cliLogin`'s shape.

### A call runs off the UI thread

`get_health()`/`cli_login()` are synchronous `httpx` calls. Textual's event
handlers are coroutines but run on the single UI thread by default, so a slow
or hanging request would freeze the whole screen -- input, redraws, the lot.
The call runs via `asyncio.to_thread`, which is enough for a debug tool making
one request at a time; a full `Worker`-based cancel-in-flight UI is more
machinery than a screen with no concurrent calls in flight needs.

### The result replaces the detail pane, not a separate area

A successful call's response model, or a raised exception's `status` and
`payload`, is rendered into the same `#detail` pane the endpoint's
description occupies -- reselecting the row (or picking another endpoint)
goes back to showing the schema. Splitting "documentation" and "last result"
into two panes would need a bigger screen budget than a terminal reliably
has; showing the result where the docs were is what swagger-ui itself does
with its "Responses" section once you've executed a request.

### The internal API layer is generated, not hand-written

The project's other models (`CourseIdentity`, `ServerConfig`) are hand-written
Pydantic classes, but the API surface is a moving target defined by another
repository, and every endpoint's request shape, response shape, and
documented error statuses already exist as a single source of truth: the
server's `openapi.json`. Hand-writing a wrapper per endpoint means re-typing
that source of truth and letting the two drift; generating it means the only
thing anyone edits by hand is which endpoints to generate.

`python -m codehood_cli.api.generate` reads the spec and writes
`src/codehood_cli/api/generated.py`, headed with `# This file is
AUTO-GENERATED. DO NOT EDIT!`. A developer runs it and commits the result —
see "Codegen is a manual, committed step" below for why this isn't automatic.

### `ENDPOINTS` is the one hand-maintained list

Not every operation the server exposes needs a CLI wrapper on day one, and
generating all of them speculatively means generating code nothing calls.
`src/codehood_cli/api/generate.py` declares:

```python
ENDPOINTS = {"getHealth", "cliLogin"}
```

a set of `operationId`s, each one required to exist in the spec being
generated from. Adding an endpoint the CLI needs is a one-line diff; codegen
fails loudly if an id in the set is missing from the spec, rather than
silently generating nothing for it.

Using `operationId` rather than a hand-written `(method, path)` pair is the
one change from the original sketch: the spec already assigns every operation
a stable id, so `ENDPOINTS` naming a path itself would be a second copy of
information the spec already owns, and the two would eventually disagree
about a path the server renamed. (An earlier draft of this file spelled paths
by hand — `"health"`, `"login"` — and neither matched the server's real
`/api/health` and `/api/auth/cli-login`; that mismatch is what surfaced this.)

### Browsing shows only registered endpoints, but their live shape

`codehood api` lists exactly the operations in `ENDPOINTS` — the ones the CLI
has, or will have, a typed function for — not the server's full operation
list. A developer exploring the whole API is better served by the server's
own `/api/docs`; this tool exists to answer "what can `codehood` itself talk
to," which is a different, narrower question.

What it shows for each one, though, is read from the parsed spec every time:
summary, parameters, request/response schemas, exactly as `openapi.json`
currently states them. `ENDPOINTS` fixes *which* endpoints appear; it says
nothing about their shape.

### One exception class per schema, not per (operation, status)

The server reuses schemas across statuses and operations — `ApiError` backs
both `cliLogin`'s 400 and its 401 — so an exception generated per schema
necessarily can't be caught per specific failure mode on its own. The
alternative, synthesizing a class per `(operationId, status)` pair (e.g.
`CliLogin400Error`), was considered and rejected: it multiplies classes for
no reason when ten endpoints all raise the same well-known `ApiError` shape.

Instead, every exception carries `.status`, the actual HTTP status code the
server sent, so `except ApiError as e: ...` can still branch on `e.status`
when a caller needs to. All of them inherit `CodehoodAPIError`
(`api/base.py`), so `except CodehoodAPIError` catches anything the generated
layer raises.

The parsed body lives at `.payload`, and each of its fields is mirrored as a
property directly on the exception, so `e.error` reads as naturally as
`e.payload.error`. This needs one naming trick: the exception class and its
payload model would otherwise collide on the schema's own name (`ApiError`
the exception vs. `ApiError` the data class), so the payload model is nested
inside the exception as `Payload`:

```python
class ApiError(CodehoodAPIError):
    class Payload(Model):
        error: str

    payload: Payload

    @property
    def error(self) -> str:
        return self.payload.error
```

### A shared client, threaded through as an optional parameter

Every generated function takes `client: httpx.Client | None = None`, and
builds one from `api.base.get_client()` — defaulting to `[server].url` in the
current directory's `codehood.toml`, or `http://localhost:4321` when there is
none — if the caller doesn't pass one. Two things this buys: generated code
stays free of config-reading logic, and a test can pass a fake or
`httpx.MockTransport`-backed client without any of the generated function's
signature changing.

### Codegen is a manual, committed step -- but drift now has a test

`generated.py` is committed like any other source file; nothing regenerates
it automatically before a commit. What changed from the first draft: the
open question about a CI-style drift check (mirroring the server's own
`test/openapi.spec.ts`, which guards its Zod schemas against its own spec)
is answered by `tests/test_api_integration.py` --
`test_generated_client_matches_what_codegen_would_produce_now` regenerates
from the live server and diffs against the committed file, and
`test_live_spec_matches_committed_snapshot` does the same for
`resources/openapi/codehood.json`. Both need a real server, so they run
only on request (see "Integration tests are opt-in and env-configured"
below) rather than on every commit -- closer to a manual safety net one runs
before a release than a CI gate, but the check exists now instead of only
being discussed.

### Integration tests are opt-in and env-configured

`tests/test_api_integration.py` calls a real Codehood server instead of
`httpx.MockTransport` -- proof the generated client's shape still matches
reality, not just the fixtures in `test_api_generated.py`. Two consequences
follow from "real server":

The target is `CODEHOOD_SERVER`, an environment variable defaulting to
`http://localhost:4321` -- Astro's default dev port, and the same default
`api.base.get_client`/`api.generate`'s codegen CLI already fall back to --
whoever runs these points them at whatever server they have, without editing
the test file.

They must not run by default. The rest of the suite is hermetic and fast;
these need a live process, and the failure mode for "server isn't running"
should be a clean skip, not a wall of `ConnectionRefusedError`. A
`pytest_addoption`/`pytest_collection_modifyitems` pair in `conftest.py`
skips anything marked `integration` unless `--run-integration` is passed
(`task test-integration` is the shortcut) -- deliberately not `addopts = "-m
'not integration'"`, since that composes with a command-line `-m
integration` as AND rather than override, silently selecting nothing the
first time someone tries to opt in. On top of that opt-in, the `client`
fixture itself probes `/openapi.json` once per session and skips with a
clear reason if nothing answers, so `--run-integration` on a machine with no
server running still fails clearly rather than hanging on connection
timeouts across four tests.

The bad-credentials login test needs no real account for the same reason the
whole suite needs no fixture data: `does-not-exist@example.invalid` /
`"wrong"` deterministically exercises the 401 path on any server, and
parsing that response into `ApiError` at all is the actual thing being
proven -- a wire-format match, not a claim about any specific user.

### The type mapper covers what the server currently emits, nothing more

Every schema in today's `openapi.json` is a flat object of strings, integers,
enums, arrays, and `$ref`s to other named schemas. The generator's JSON
Schema → Python type mapper covers exactly that: `string` (`Literal[...]`
when `enum` is present), `integer`, `number`, `boolean`, `array`, and `$ref`.
An inline `object` schema, or `anyOf`/`oneOf`/`allOf`, raises a clear
"not supported yet" error at generation time rather than guessing — better to
fail loudly the day the server adds one than to silently emit `Any`.

## Proving it works

- **Codegen produces valid, importable code.** Feed the generator a small
  fixture spec (a `health`-shaped and a `cliLogin`-shaped operation) and
  assert the emitted source `exec`s cleanly and defines the expected function
  and exception names.
- **Generated functions round-trip a fake response.** Using
  `httpx.MockTransport`, assert a 200 response parses into the right typed
  model, and each documented error status raises the right exception with
  `.status` and the right `.payload` fields populated.
- **Real spec regression.** `resources/openapi/codehood.json`, a committed
  snapshot of the server's actual `openapi.json`, regenerates without error
  for both entries in `ENDPOINTS` — this is the test that catches the server
  renaming a path or dropping an operation `ENDPOINTS` still names.
- **Unknown `ENDPOINTS` entry fails loudly.** An `operationId` not present in
  the spec raises a clear error naming it, rather than generating nothing.
- **Browsing reads the live spec.** Feed `codehood api`'s data source a
  fixture spec and assert the rows shown match its operations, summaries, and
  parameters — and that changing the fixture's summary changes what's shown,
  proving nothing is cached from a previous run in Python.
- **The detail pane shows response schemas too**, resolved the same way
  parameters and the request body are, not just each status's description.
- **Calling an unauthenticated endpoint with no body works end to end**
  (`getHealth`), and one with a body round-trips real input through the modal
  into the generated function's `body` argument (`cliLogin`), against a fake
  transport.
- **Calling a would-require-auth endpoint refuses before making a request.**
  A fixture operation with a non-empty `security` never reaches `client.get`/
  `client.post` — asserted by a transport that raises if called at all.
- A terminal capture of `codehood api` running against a local server, in the
  PR, including one successful call and one refused (auth-gated) call.
- **Integration: a real `getHealth` parses into a generated shape**,
  whichever of `HealthOk`/`HealthError` the live server actually returns.
- **Integration: a real `cliLogin` with bad credentials raises `ApiError`**
  with `.status` in `{400, 401}` and a populated `.error`.
- **Integration: the committed spec snapshot and `generated.py` both still
  match the live server** -- either failing names exactly what to
  regenerate and where.
- All four integration tests skip cleanly, with a stated reason, when no
  server answers at `CODEHOOD_SERVER` -- proven by running the suite with
  nothing listening on the port.

## Out of scope

- **Calling an endpoint that requires auth.** Refused with a clear message
  (see "Calling is gated by the spec's own `security`" above) rather than
  attempted. Blocked on the auth spec building a credentials store.
- **Integration tests running in CI, or on every commit.** They're a command
  a developer runs on demand (`task test-integration`); nothing wires them
  into a pipeline or a pre-commit hook yet.
- **Full JSON Schema support.** `anyOf`/`oneOf`/`allOf` and inline `object`
  schemas raise rather than generate. Every schema in today's spec is flat
  enough not to need this; it becomes real work the day one isn't.
- **Non-JSON request/response bodies.** Only `application/json` media types
  are read from `requestBody`/`responses`; anything else in `content` is
  ignored.

## Open questions

- **Should the integration tests run in CI against a spun-up server?** They
  answer the drift question this spec used to leave open, but only for
  whoever remembers to run `task test-integration` locally. Wiring a
  throwaway server into CI so they run on every PR is the natural next step,
  once there's a cheap way to stand one up there.
- **Does `ENDPOINTS` grow to cover most of the server's surface, or stay
  scoped to what real commands need?** This spec assumes the latter — `push`,
  `roster`, and `login` each add their own operationIds when they're built —
  but if `codehood api` turns out to be used as a general debugging tool by
  people who aren't implementing a CLI command, that argues for generating
  everything and letting browsing filter, not `ENDPOINTS` gatekeep.
