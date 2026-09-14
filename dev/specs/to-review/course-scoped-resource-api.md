# Course-scoped REST addressing for resources

`/api/resource` addresses a resource by numeric id, or filters by numeric
`courseId`, so the CLI has to resolve a course id before it can touch anything
inside a course. FR-SYNC-010 says the CLI never learns internal ids.

This spec moves the resource endpoints under the course's natural-key address,
reusing the multi-segment PK mechanism from `course-natural-key-api.md`:

```
GET    /api/course/<discipline>/<instructor>_<edition>/resource          list
POST   /api/course/<discipline>/<instructor>_<edition>/resource          create
GET    /api/course/<discipline>/<instructor>_<edition>/resource/<slug>   read
PUT    /api/course/<discipline>/<instructor>_<edition>/resource/<slug>   upsert
PATCH  /api/course/<discipline>/<instructor>_<edition>/resource/<slug>   update
DELETE /api/course/<discipline>/<instructor>_<edition>/resource/<slug>   delete
```

`/api/resource/*` is removed, not deprecated. `time-slot`, `calendar-event`,
`passphrase` and `exam` follow in later changes using the same mechanism
(`BACKLOG.md`).

## Decisions

### 1. The service resolves the course ref, not the API layer

`ResourceService` accepts a `courseRef` wherever it accepts a `courseId`. The
REST layer stays syntactic: it turns path segments into a `courseRef` and hands
it down. RPC, actions and REST therefore share one set of semantics, and
`src/api/index.ts` stays a thin layer.

Schemas (`src/core/schemas.ts`):

```ts
resourceSlug = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)

resourceRef  = { courseId, slug } | { courseRef, slug }   // was { courseId, slug }
resourcePK   = { id } | { ref: resourceRef }              // unchanged shape
resourceCreate.courseId  -> optional
resourceCreate.courseRef -> new, optional                 // exactly one required
resourceFilter                                            // unchanged
```

The field is named `courseRef` everywhere, matching the existing
`resourceFilter.courseRef`. "Exactly one of `courseId`/`courseRef`" is checked by
the service (400), not by a Zod refinement, because the REST layer derives its
schemas with `.omit()` and Zod 4 refuses to omit from a refined object.

### 2. Slug grammar is enforced by the server

`^[a-z0-9][a-z0-9._-]*$`: flat, no slash. The CLI normalizes nested paths and bad
file names into this form; the server validates anyway, because the grammar is
what makes a single `[slug]` segment correct. The web route
`resources/[slug].astro` already assumed it.

Checked `dev.db` before landing: 8 resources, 0 violate the grammar.

### 3. Status codes

| Case                                         | Status |
| :------------------------------------------- | :----- |
| Course segment or slug malformed             | 400    |
| No such course                               | 404    |
| Course exists, actor may not see its content | 403    |
| Course visible, no such slug                 | 404    |

The list endpoint follows the same table. A client that names one course and
may not see it gets 403, not `[]`; the empty array is a lie once the course is
in the path. The flat service call `findMany({ courseId })` keeps filtering in
SQL and returning `[]`, since no course was named by ref.

A `courseRef` that resolves to no course is 404 on writes too.

### 4. `CRUD` gains `parseScope` and `upsert`

The collection path may now contain dynamic segments:

```ts
CRUD("/api/course/[discipline]/[course]/resource", {
  parseScope: (params) => ({ courseRef: parseCourseParams(params).ref }),
  pkPath: "/[slug]",
  parsePk: ...,
  filter: schema.resourceFilter.omit({ courseId: true, courseRef: true }),
  create: schema.resourceCreate.omit({ courseId: true, courseRef: true }),
  upsert: schema.resourceUpsert.omit({ courseId: true, courseRef: true, slug: true }),
  ...
})
```

- `parseScope(params)` returns the fields the path owns. CRUD merges them over
  the query filter (`findMany`) and the body (`create`, `upsert`). Path wins; the
  REST schemas omit those fields so the OpenAPI document never advertises them.
- `PUT <pathWithId>` already calls `service.upsert` for every `CRUD`. The new
  `upsert` option is the PUT body schema; when set, the handler merges
  `{ ...body, ...scope, ...itemSegments }`, where `itemSegments` are the
  `pkPath` segments by name (`slug`). Without it, PUT keeps taking the `create`
  body verbatim, so no other resource changes behaviour.
- `ResourceService.update`/`delete` throw `NotFound` for a missing resource
  instead of a bare `Error`, which reached HTTP as a 500.
- `courseId`/`courseRef` stay on the service types; they are service-level
  options only.

### 5. Out of scope

- The other four course-scoped resources.
- Dropping `id` from REST responses (waits for the whole subtree).
- `findMany({ courseId })` authorization semantics.

## Tests

Seams:

- `ResourceService` public methods (`test/resource-service.spec.ts`): `courseRef`
  branches of `findOne`, `findMany`, `create`, `upsert`; 404/403 on course;
  slug grammar; exactly-one course field.
- REST over HTTP (`test/api-resource.spec.ts`): every method on the nested path,
  status-code table, PUT idempotency, flat `/api/resource` gone.
- OpenAPI document (`test/openapi.spec.ts`): nested paths present, no
  `courseId`/`courseRef` query or body fields.

## Artifacts

- Regenerate `src/api/registry/route-patterns.json`.
- Bump `package.json` version.
- `docs/design/url-structure.md`: document the `/api/course/...` subtree.
- `GLOSSARY.md`: **Course-scoped endpoint**.
- `CHANGELOG.md` entry; tick the resource part of the `BACKLOG.md` item.