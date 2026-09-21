# REST API

The REST API lives under `/api/*` and is addressed as described in
`src/urls/README.md`. Endpoints are declared once, as data, in
`src/api/index.ts`: a declaration carries the Zod schemas, the service it
delegates to, and the path. From that single declaration the registry derives
the request validation, the response validation, the Astro route and the
OpenAPI 3.0 entry, so the documentation cannot drift from the handler.

OpenAPI generation uses [`@asteasolutions/zod-to-openapi`][lib]. The document
is served at `/openapi.json` and browsable as Swagger UI at `/api/docs`.

[lib]: https://github.com/asteasolutions/zod-to-openapi

## Where things live

| File                           | Role                                           |
| :----------------------------- | :--------------------------------------------- |
| `index.ts`                     | Every endpoint declaration [^decl]             |
| `auth.ts`                      | Login and logout [^auth]                       |
| `health.ts`                    | `GET /api/health`                              |
| `utils.ts`                     | Shared path-segment parsers                    |
| `registry/route.ts`            | `route()` and the verb wrappers [^route]       |
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
    `health.ts`.

[^auth]: `POST /api/auth/login` and `POST /api/auth/logout`. Hand-written
    because no service CRUD sits behind them.

[^route]: The core. Registers the path on the shared `registry`, validates
    input, calls the handler, parses the result through `out`, and turns a
    thrown error into a JSON response. Also declares the `BearerAuth` scheme.

[^doc]: Imports `dynamicHandler` for its registration side effects, then turns
    `registry.definitions` into the document.

[^dyn]: Looks the request's `routePattern` up in the registry and dispatches.
    Every `/api/*` route is injected pointing here.

[^gen]: Read by `hook.ts`. See "The generated pattern list" below.

[^extend]: It runs before any schema calls `.openapi(...)` because every schema
    module imports this one.

[^cache]: Cached for the life of the process in production, rebuilt per request
    in dev.

[^swagger]: Deliberately not built on `src/layouts/Layout.astro`: Tailwind's
    Preflight reset strips the default element styling Swagger UI's own CSS
    depends on, so the page stays an isolated HTML document.

[^vendor]: Five files from `swagger-ui-dist`, keyed off a fixed filename
    allowlist rather than a path join of the request.

## What `CRUD()` generates

| Method   | Path       | Service call                                    |
| :------- | :--------- | :---------------------------------------------- |
| `POST`   | collection | `create`                                        |
| `GET`    | collection | `findMany`                                      |
| `PUT`    | collection | `upsert` (keyed on the natural key in the body) |
| `GET`    | item       | `findOne`                                       |
| `PATCH`  | item       | `update`                                        |
| `DELETE` | item       | `delete`                                        |

The item path is the collection path plus `keySegment`, which defaults to
`/[id]`. A declaration omits an operation by passing `null` for the schema it
needs, so `inviteApi` with `update: null` registers no `PATCH`.

## No generation step for the document

There isn't one. The document is built from the live registry on demand, so
there is no committed artifact to forget to regenerate. `test/openapi.spec.ts`
asserts that the response from `/openapi.json` equals `buildOpenApiDocument()`.

`test/bruno/openapi.json` is a separate, checked-in snapshot used by the Bruno
request collection. It is not what the server serves.

## The generated pattern list

`route-patterns.json` is the one generated artifact. Astro needs its routes at
`astro:config:setup`, before the route modules can be imported (they pull in
Astro internals that are not ready yet), so the patterns are written to disk
instead.

`pnpm run route-patterns` regenerates it from the live registry, and both
`pnpm run dev` and `pnpm run build` run it first. A new endpoint that does not
appear in the file is not routed.

## Authentication defaults to required

`generateDocument`'s top-level `security` is `[{ BearerAuth: [] }]`, so every
route requires a CLI or bot API key unless it opts out.

The opt-out is `isPublic: true` on the declaration. It does two things: emits
`security: []` into the document, and skips the 401 that `route.view` otherwise
throws when `locals.actor` is empty. Two routes use it — `GET /api/health` (a
probe has no key yet) and `POST /api/auth/login` (which is how you get one).
`POST /api/auth/logout` is *not* public; it needs a session to end.

The default is "requires a key" on purpose, so forgetting the flag fails safe.
