# RPC interface

A JSON-RPC 2.0 endpoint at `POST /rpc`, beside the REST API rather than
replacing it. REST keeps the CRUD surface; RPC takes the operations that are
bad to model as CRUD — anything verb-shaped ("sync this course tree",
"regrade this submission") where the resource being POSTed to is a fiction.

This spec covers the plumbing plus one method, `health.check`. It is the
skeleton, not the method catalogue.

## Why JSON-RPC and not gRPC

- gRPC needs HTTP/2 framing and a separate server process. Astro's node
  adapter hands us `Request`/`Response`; there is no place to put a gRPC
  server without running a second one.
- The schema source of truth would move to `.proto` files, duplicating the Zod
  schemas that already validate requests and generate the OpenAPI document.
- Browsers cannot speak gRPC without grpc-web plus a proxy. The web app is a
  first-class caller here.
- tRPC was also rejected: it pins every client to TypeScript, has no wire spec
  to hand a non-TS CLI, and produces no documentation artifact.

JSON-RPC is a two-page spec over plain POST. Requests are readable in a
network tab and reproducible with `curl`.

## Wire protocol

Single endpoint, `POST /rpc`, `content-type: application/json`.

```json
{ "jsonrpc": "2.0", "method": "health.check", "params": {}, "id": 1 }
```

- **Method names** are `namespace.verb`. The namespace matches the REST
  resource where one exists, so `course.sync` and `/api/course` are visibly the
  same subject.
- **Params are by-name only.** A positional array is rejected with `-32602`:
  every handler validates against a Zod object, and there is no stable
  argument order to map onto.
- **Batch** requests (a top-level array) are supported, as the spec requires.
  Methods in a batch run sequentially, each isolated: one failing produces its
  own error object, not a failed batch.
- **Notifications** (no `id`) run and return nothing. An all-notification batch
  gets HTTP 204 with an empty body.
- **HTTP status is 200** for everything the envelope can describe, including
  method errors. Non-200 is reserved for a body that is not a JSON-RPC message
  at all (400 for unparseable JSON, 405 for a non-POST verb).

## Registration

Mirrors `src/api/registry/index.ts`. A `METHOD(name, options)` helper takes the
same shape `GET`/`POST` take — `isPublic`, `in`, `out`, `summary`,
`description`, `tags`, `handler({ actor, body })` — minus `params`, which has
no meaning without a path. It registers into a module-level `METHODS` map and
into the OpenRPC registry.

Files:

| File | Role |
| :---------------------- | :-------------------------------------------- |
| `src/rpc/registry/index.ts` | `METHOD()`, the `METHODS` map, error mapping |
| `src/rpc/registry/openrpc-document.ts` | `buildOpenRpcDocument()` |
| `src/rpc/health.ts` | `health.check` |
| `src/rpc/index.ts` | Imports every method module, as `src/api/index.ts` does |
| `src/pages/rpc.ts` | The endpoint: parse, dispatch, serialize |

Handlers return values and throw errors, exactly like REST handlers. Nothing in
a handler knows it is being called over JSON-RPC.

## Permissions

- Authentication is unchanged and per-request: `sessionMiddleware` and
  `apiKeyMiddleware` populate `locals.actor` before the route runs, so a
  browser cookie and a CLI `Bearer` key both work with no RPC-specific code.
- `isPublic: true` is per method, and the default is authenticated. A method
  that omits it and is called without an actor fails with `-32001` before the
  handler runs. Forgetting the flag fails closed.
- A batch runs entirely under one actor. There is no per-call credential.
- Authorization stays in the service classes, reached through `{ actor }`. The
  RPC layer decides "actor required or not" and nothing else.

## Errors

`responseFromException` already maps a thrown error to `{ code, message,
status, ... }`. The RPC layer reuses it and wraps the result in a JSON-RPC
error object, putting the whole payload in `error.data` so no detail is lost.

| Condition | Code |
| :--------------------------- | :------ |
| Unparseable JSON | -32700 |
| Not a JSON-RPC request object | -32600 |
| Unknown method | -32601 |
| Zod validation failure, or positional params | -32602 |
| Unexpected throw, or a dependency being down | -32603 |
| Authentication required | -32001 |
| Permission denied | -32002 |
| Not found | -32003 |
| Domain error (everything else from `responseFromException`) | -32000 |

`-32602` carries `InvalidData`'s field errors verbatim in `error.data.errors`,
the same structure the REST API returns.

## Documentation

An [OpenRPC](https://open-rpc.org) document, the JSON-RPC counterpart of
OpenAPI, generated from the same Zod schemas the handlers validate against via
`z.toJSONSchema()` (built into Zod 4).

Served at `GET /openrpc.json` by `src/pages/openrpc.json.ts`, built on first
request and cached for the life of the process — the same approach
`src/pages/openapi.json.ts` now uses. No generator script, no committed
artifact, nothing to go stale.

The UI is the spec's fallback, not `@open-rpc/inspector`. The inspector ships
as a React/MUI component library rather than a standalone bundle, so
self-hosting it means pulling React 19, MUI 6 and emotion into a SolidJS app to
render one documentation page. That is a worse trade than projecting the same
registry into OpenAPI and reusing the Swagger UI the REST API already
self-hosts.

So: `src/rpc/registry/openapi-projection.ts` describes each method as its own
`POST /rpc#<method>` operation, served at `/rpc/docs/openapi.json` and rendered
by `/rpc/docs`, which shares the vendor assets under `/api/docs/vendor/`. The
fragment only exists to keep the paths distinct in a document where every
operation posts to one URL; browsers strip it before sending, so "Try it out"
reaches `/rpc` and works.

`/openrpc.json` is still the machine-readable description of the protocol, and
the docs page links to it.

## `health.check`

The one method in this spec, and the proof the plumbing works.

- `isPublic: true`. Whatever is probing usually has no API key; that is often
  what it is checking.
- Same body as `GET /api/health`: `SELECT 1` against the database, returning
  `{ status: "ok", database: "ok" }`.
- Unlike the REST route it does not answer 503. A database it cannot reach is
  an error object inside a 200, because the transport is fine — conflating
  "server unreachable" with "database unreachable" is exactly what a probe
  must not do. `GET /api/health` keeps its 503 for monitors that only read
  status codes.
- The error is `-32603` and not `-32000`: an unreachable database is a
  server-side failure, which is what -32603 means. It is thrown as
  `Unavailable`, a new `core/error` class for "the server is up but something
  it depends on is not", whose response carries status 503.

## Tests

`test/rpc.spec.ts`:

1. `health.check` over `POST /rpc` returns the expected result, unauthenticated.
2. Unknown method returns -32601, HTTP 200.
3. A non-public method without credentials returns -32001 and never reaches its
   handler.
4. Bad params return -32602 carrying field errors.
5. A batch of two returns two results, matched by `id`.
6. A notification returns 204 and an empty body.
7. Unparseable JSON returns HTTP 400 with a -32700 body.
8. `GET /openrpc.json` matches `buildOpenRpcDocument()` and lists
   `health.check`.

Method 3 needs a second, non-public method to test against. Use a
`debug.whoami` returning the actor's username — small, genuinely useful for CLI
troubleshooting, and not worth a spec of its own.
