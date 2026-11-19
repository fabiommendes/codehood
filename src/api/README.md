# REST API

The REST API lives under `/api/*` and is addressed as described in
`src/urls/README.md`. The decisions behind it are ADRs:

- [ADR 0007](../../dev/adr/0007-endpoints-rest-declarados-como-dados-com-openapi-derivado.md):
  endpoints are declared once, as data, in `src/api/index.ts`; the registry
  derives validation, routing and the OpenAPI document from that declaration,
  and `CRUD()` turns a Service into up to six routes.
- [ADR 0008](../../dev/adr/0008-rest-api-exige-chave-de-api-por-padrao.md):
  every route requires a session cookie OR a Bearer key unless declared
  `isPublic: true`. Sending both is rejected before credential validation.
  Unsafe API requests with a foreign Origin are refused unless authenticated
  with Bearer; form-like requests without Bearer require a local Origin.

`rest.batch` on `/rpc` dispatches JSON-only operations through the same REST
views, in order, without internal HTTP or a global transaction. It excludes
login/logout, multipart and pages outside the registry. See
[`rest.batch`](#restbatch) below for the contract.

A list route answers `{ items, next, prev }`: one page and the cursors of the
pages around it, `null` where the list ends. `CRUD()` pages a resource whose
service has `findPage`, and its list then takes `limit` (default 100, at most
500) and either `after` or `before`; the others answer everything with both
cursors `null`. A client follows `next` until `null` on every list. The
cursors are made in the service, with `src/utils/cursor.ts`, because the
entity does not carry the row id. A list a service can order by more than one
column (questions) keeps the column value and the row id in the cursor, and
refuses with `400` a cursor made under another order; over REST such a list
comes in its default order.

This file maps where each piece lives.

## Where things live

| File                           | Role                                           |
| :----------------------------- | :--------------------------------------------- |
| `index.ts`                     | Every endpoint declaration [^decl]             |
| `auth.ts`                      | Login and logout [^auth]                       |
| `health.ts`                    | `GET /api/health`                              |
| `utils.ts`                     | Shared path-segment parsers                    |
| `registry/index.ts`            | Re-exports `CRUD` and the verb wrappers        |
| `registry/route.ts`            | `route()` and the verb wrappers [^route]       |
| `registry/multipart.ts`        | Multipart readers for `inMultipart` [^mp]      |
| `registry/conditional.ts`      | `If-Match`/`If-None-Match` and `ETag` [^cond]  |
| `registry/crud.ts`             | `CRUD()` — one resource into six routes        |
| `registry/openapi-document.ts` | `buildOpenApiDocument()` [^doc]                |
| `registry/dynamicHandler.ts`   | The Astro entrypoint every route shares [^dyn] |
| `registry/hook.ts`             | The Astro integration that injects the routes  |
| `registry/route-patterns.json` | Generated pattern list [^gen]                  |
| `registry/util.ts`             | `[id]` to `{id}` translation                   |

Outside this directory:

| File                                  | Role                                      |
| :------------------------------------ | :---------------------------------------- |
| `src/core/schemas/base.ts`            | Calls `extendZodWithOpenApi(z)` [^extend] |
| `src/pages/openapi.json.ts`           | Serves the document [^cache]              |
| `src/pages/api/docs/index.astro`      | Swagger UI [^swagger]                     |
| `src/pages/api/docs/vendor/[file].ts` | Self-hosted Swagger assets [^vendor]      |

[^decl]: `CRUD(path, opts)` for a service-backed resource, `GET`/`POST`/`PATCH`
    for a one-off. Nothing registers routes except this file, `auth.ts` and
    `health.ts`. The hand-written routes outside the registry are
    `src/pages/api/report/[publicId]/attachment/[filename].ts` and
    `src/pages/api/course/[discipline]/[course]/assignment/[slug]/team/[team]/git/[...rest].ts`
    (the read-only smart git protocol of a team repository, which a Bearer key
    opens and a git client speaks), neither in the OpenAPI document.

[^auth]: `POST /api/auth/login` and `POST /api/auth/logout`. Hand-written
    because no service CRUD sits behind them.

[^route]: The core. Registers the path on the shared `registry`, validates
    input, calls the handler, parses the result through `out`, and turns a
    thrown error into a JSON response. Also declares the `BearerAuth` scheme.

[^mp]: Rejects a body over the size limit with 413. `inMultipart: true` reads
    form fields into `in`. `inMultipart: "json"` takes a JSON body, or a
    multipart one with that JSON in a `json` part and one file part per blob,
    named by its sha-256 and checked against it. `CRUD()` turns it on for the
    write routes when `withFiles` is set: the resource route uses it so a
    `FILE` and its bytes arrive in one request.

[^cond]: ADR 0013. A route declared `versioned` (`CRUD()` sets it when the
    entity has `updatedAt`) reads `If-Match: "<updatedAt>"` and, on `PUT`,
    `If-None-Match: *` into the `expectedUpdatedAt` of its write, and answers
    the row's `ETag`. A weak ETag, a list, `*` in `If-Match`, or either header
    on a route without version is a 400. `GET` and `POST` ignore them. A
    `-gzip`, `-zstd` or `-br` suffix a compressing proxy adds to the ETag is
    accepted back in `If-Match`. A `GET` of an entity with `updatedAt: null`
    (a rubric not yet written) answers no `ETag`. `rest.batch` forwards no
    headers, so a batch cannot write conditionally.

[^doc]: Imports `dynamicHandler` for its registration side effects, then turns
    `registry.definitions` into the document. It strips the `form` meta of the
    schemas (ADR 0001) and folds `examples` into a single `example`.

[^dyn]: Looks the request's `routePattern` up in the registry and dispatches.
    Every registered `/api/*` route is injected pointing here.

[^gen]: Read by `hook.ts`. See "Generated files" below.

[^extend]: It runs before any schema calls `.openapi(...)` because every schema
    module imports this one.

[^cache]: Cached for the life of the process in production, rebuilt per request
    in dev.

[^swagger]: Deliberately not built on `src/layouts/Layout.astro`: Tailwind's
    Preflight reset strips the default element styling Swagger UI's own CSS
    depends on, so the page stays an isolated HTML document.

[^vendor]: Five files from `swagger-ui-dist`, keyed off a fixed filename
    allowlist rather than a path join of the request.

## Generated files

`registry/route-patterns.json` is regenerated by `pnpm run route-patterns`,
which `pnpm run generate` runs before `dev` and `build` (why it exists: ADR
0007). `test/bruno/openapi.json` is a checked-in snapshot used by the Bruno
request collection, not what the server serves.

## `rest.batch`

`params: {verb, requests: [{id, path, body?, query?}]}`. `verb` is one of
GET, POST, PUT, PATCH, DELETE and applies to every item. GET and DELETE take
`query` (strings or lists of strings, coerced as in REST); the other verbs
take a JSON `body`. A path is a local absolute `/api/` path with no origin,
query string, fragment, double slash or dot segment. The result is a list of
`{id, status, body}` in request order. Ids may repeat and are not
deduplicated, so a resend may repeat side effects.

Items run one after another with no transaction: a failing item neither
undoes the earlier ones nor stops the later ones. Per-item statuses: 400 for
an invalid path, a field the verb does not take or an excluded route; 404 for
no route; 405 for a verb the route does not register; 413 for an item over
the limit. Domain errors keep their REST status.

Limits: at most 50 items, 64 KiB of UTF-8 per serialized item, 1 MiB for the
whole `/rpc` body (counted while reading, independent of `Content-Length`;
over it the HTTP answer is 413 and nothing runs), 50 calls per JSON-RPC batch.
The limits apply to input, not output: use the REST filters to keep responses
small. A bad envelope fails as a whole (`-32602`; no credentials, `-32001`).

```json
{
  "jsonrpc": "2.0",
  "id": "read",
  "method": "rest.batch",
  "params": {
    "verb": "GET",
    "requests": [
      {"id": "me", "path": "/api/user/me"},
      {"id": "admins", "path": "/api/user", "query": {"usernames": ["admin"]}}
    ]
  }
}
```
