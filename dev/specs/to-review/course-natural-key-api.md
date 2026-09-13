# Natural-key addressing for the course REST endpoints

`GET /api/course/42` addresses a course by its autoincrement id. Every other
layer already addresses it by its natural key: `Course` has
`@@unique([disciplineSlug, instructorId, editionSlug])`, `coursePK` is a union
of `{ id }` and `{ ref }`, `courseService.findOne` resolves both, and the web
app routes on `src/pages/[discipline]/[course]/*` built by `courseHref()`. Only
the REST layer still demands an id, which means the CLI cannot address a course
from local configuration without a lookup round-trip first.

This spec moves the course endpoints to

```
/api/course/<discipline>/<instructor>_<edition>
```

the same string `courseHref()` produces, and generalizes the `CRUD` helper so
the five course-scoped resources can follow later (see `BACKLOG.md`).

## Scope

The service layer does not change. The work is in `src/api/registry/index.ts`,
`src/core/schemas.ts`, the generated artifacts, and the tests.

### 1. Multi-segment primary keys in `CRUD`

`CRUD` hardcodes one dynamic segment:

```ts
const pathWithId = `${path}/[id]`;
```

and `options.pk` renames the *field* that single segment carries. Two new
options, both defaulting to today's behaviour so no other call site changes:

```ts
pkPath?: string;                              // default: "/[id]"
parsePk?: (params: Record<string, string>) => unknown;
```

`pkPath` is appended to `path` to form the pattern registered for `findOne`,
`update` and `delete`. `parsePk` replaces the local closure of the same name;
the default keeps the `params.id` → `params[options.pk]` rename and validates
against `options.filterPk`.

`courseApi` passes `pkPath: "/[discipline]/[course]"` and a `parsePk` built on
`parseCourseSegment()` from `src/utils/course-url.ts`.

Nothing downstream needs changing: `scripts/generate-route-patterns.ts` reads
the live `ROUTES` registry, `hook.ts` injects whatever patterns it finds, and
`dynamicHandler.ts` dispatches on `context.routePattern`.

### 2. `coursePkRef`

```ts
export const coursePkRef = z.object({ ref: courseRef });
```

`courseApi` passes this as `filterPk` instead of `coursePK`. The union stays
the service-level type: `findOne` genuinely resolves both branches, while the
REST address is only ever a ref. Keeping them separate states that contract in
the schema rather than in a comment, and lets the OpenAPI parameter generation
below derive segments without special-casing a union.

### 3. `/api/course/[id]` is removed

Not deprecated, not 410 — removed. Nothing is deployed against this API and
both sides land together. Bump `package.json` version, which the OpenAPI
document reads.

`id` stays in `courseSchema` and in REST responses. Dropping it from the REST
surface waits until every course-scoped endpoint is naturally addressable, so
that nothing has to round-trip an id to reach a resource.

### 4. Status codes

Deliberately different from the web app, which `docs/design/url-structure.md`
commits to 404 for a malformed segment:

| Case                                  | Status |
| :------------------------------------ | :----- |
| Segment does not match the grammar    | 400    |
| Grammar matches, no such course       | 404    |
| Course exists, actor may not see it   | 403    |

A person typing a URL cannot act on a 400, so the web app rounds everything
down to 404. The CLI can: `ada_not-a-year` is a malformed local configuration,
and reporting it as "no such course" sends the user hunting for the wrong
problem.

### 5. OpenAPI path parameters

`route()` passes Astro's pattern verbatim to `registry.registerPath`, so
`public/openapi.json` publishes `"/api/course/[id]"` — Astro's syntax, not
OpenAPI's — and declares no `parameters` at all. Path parameters are therefore
undocumented for every `CRUD` resource today.

Fixed here rather than separately, because this change edits the same lines and
would otherwise ship a flagship endpoint that cannot be expressed in the
document the CLI is generated from: convert `[x]` to `{x}`, and emit one
`parameters` entry per dynamic segment.

### 6. Username format on the REST create path

`USERNAME_RE` is enforced in `src/actions/admin.ts` and `src/actions/auth.ts`,
and `userUpdate` does not include `username`, so a username cannot be changed
after creation. But `userSchema.username` is `z.string().min(1)`, and
`userCreate` inherits it, so `POST /api/user` can still mint a username that
the router cannot address.

`userCreate` extends `username` with the `username` validator already exported
from `src/core/schemas.ts`. `userSchema` stays `z.string()` and keeps its four
`returns:` sites.

The reasoning belongs in `docs/design/db-service-classes.md`: input schemas
constrain values, output schemas constrain shape. Output validators are not
redundant — they whitelist what comes out of Prisma, which is where a column
added later would otherwise leak, and the typechecker will not catch that. What
they do not need to do is re-check a value constraint already enforced on
write.

Hunting down existing rows with non-conforming usernames is a migration and is
out of scope.

## Tests

- `test/api-crud.spec.ts`: replace the by-id course test with a by-ref one, and
  add one test per row of the status-code table. The comment at `:118-122`
  documents the single-`[id]`-segment constraint this change removes and needs
  rewriting.
- `test/api-course-pk.spec.ts`: a unit test on `parseCourseParams`. It is pure,
  so the grammar gets pinned without a server. The default single-segment
  `parsePk` stays covered by the discipline/edition HTTP tests.

## Documentation

- `docs/design/url-structure.md`: correct the Username section, which claims
  `acceptInvite` and `profile.update` validate usernames as
  `z.string().min(1)`; name `userCreate` as the remaining gap. Add the course
  API path and the status-code divergence to "API and actions".
- `docs/design/db-service-classes.md`: the input/output validation paragraph.
- `GLOSSARY.md`: note on "Course URL" that the same address serves the REST API
  under `/api/course/`.
- `CLAUDE.md`: one-line pointer to the validation paragraph.
- `pnpm run generate` regenerates `route-patterns.json` and
  `public/openapi.json`; `test/openapi.spec.ts` fails on drift.

## Out of scope

- The course-scoped subtree (`resource`, `time-slot`, `calendar-event`,
  `passphrase`, `exam`), whose `*Ref` schemas are still
  `{ courseId: number, slug }`. Recorded in `BACKLOG.md`.
- Dropping `id` from REST responses.
- A migration for non-conforming usernames.
