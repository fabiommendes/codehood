# OpenAPI for the REST API

The REST API (`/api/*`, see `docs/design/url-structure.md`) is documented as
OpenAPI 3.0, generated from the same Zod schemas each endpoint validates
requests against with [`@asteasolutions/zod-to-openapi`][lib] — one
definition, not a hand-written spec that drifts from the code.

[lib]: https://github.com/asteasolutions/zod-to-openapi

## Where things live

- `src/api/openapi/registry.ts` — calls `extendZodWithOpenApi(z)` (must run
  before any schema calls `.openapi(...)`, which is why every file below
  imports this one first) and exports the shared `registry` every handler
  registers into, plus the `BearerAuth` security scheme.
- `src/api/<name>.ts` — each REST handler's own file. Request/response Zod
  schemas and the `registry.registerPath(...)` call live right next to the
  handler function that validates against them, so touching one without the
  other is a diff you'd notice in review.
- `src/api/openapi/document.ts` — `buildOpenApiDocument()`, which imports
  every handler module (for the registration side effects) and turns
  `registry.definitions` into the full document. New REST endpoint modules
  need adding to its import list, or they won't appear in the spec.
- `public/openapi.json` — the generated file, served as-is at `/openapi.json`
  by Astro's static asset handling.
- `src/pages/api/docs/index.astro` — a Swagger UI page pointed at
  `/openapi.json`. Deliberately not built on `src/layouts/Layout.astro`:
  that pulls in Tailwind, and Preflight's reset strips the default element
  styling (buttons, lists, tables) Swagger UI's own CSS depends on, so this
  page stays a fully isolated HTML document instead of fighting it.
- `src/pages/api/docs/vendor/[file].ts` — self-hosts the handful of
  `swagger-ui-dist` assets that page needs (CSS, the two JS bundles, two
  favicons) from `node_modules`, rather than pulling them from a CDN.
  Gated by a fixed filename allowlist, not a path join of the request —
  the incoming segment can only ever match one of five known-safe names.

## Regenerating

```
pnpm openapi
```

`pnpm build` runs this first automatically, so a deploy can't ship a stale
spec. `test/openapi.spec.ts` also asserts the committed file matches what
`buildOpenApiDocument()` produces right now, so running the test suite
without regenerating first is a build failure, not a silent drift.

## Unauthenticated routes are the exception, not the default

`registerPath`'s security defaults to whatever `generateDocument`'s top-level
`security` says, which is `[{ BearerAuth: [] }]` — most of the REST API is
meant to require a CLI/bot API key. `/api/health` and
`/api/auth/cli-login` explicitly set `security: []` on their own
registration, because they're the two routes that must work without one (a
health probe has no key yet; cli-login is how you get one). A new
unauthenticated route needs that same explicit override — the default is
"requires a key" on purpose, so forgetting it fails safe.
