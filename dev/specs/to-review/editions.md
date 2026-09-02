# Editions

## Scope

Turn `Course.edition` from a free string into an admin-managed table with a
display name and an active window, per `FR-CRS-010` … `FR-CRS-013`.

Model, service, migration, and the places that already read an edition. The
admin UI for managing editions is the next spec; this one gives it a service to
call.

## Design decisions

### The slug is the primary key, like `Discipline`

```prisma
model Edition {
  slug      String   @id
  name      String
  startAt   DateTime
  endAt     DateTime
  createdAt DateTime @default(now())
  courses   Course[]
}
```

An edition has no identity apart from the token that appears in every course
URL, so a surrogate integer id would exist only to be joined through. This
matches `Discipline`, which made the same call for the same reason.

`slug` must match the existing `EDITION_RE` (`^[0-9]{4}(-([1-9][0-9]*|0))?$`).
The rule moves from `courseService.create`, where it was applied per course, to
`editionService.create`, where it is applied once per edition — which is the
point of the table.

### `Course` keeps its column, gains a relation

```prisma
editionSlug String  @map("edition")
edition     Edition @relation(fields: [editionSlug], references: [slug])
```

The scalar keeps the database column name `edition`, so the migration adds a
constraint rather than renaming a column. The field pair is named the way
`disciplineSlug`/`discipline` already is, so `course.editionSlug` is the token
and `course.edition.name` is the label.

`courseInclude` gains `edition: true`. Every view that shows a course can then
show "2026 · first term" instead of `2026-1`, at the cost of one join on a
query that already makes three.

### Schema applied by `db push`, then backfilled

Existing `Course` rows carry edition strings with no `Edition` to point at, so
the schema change alone leaves dangling references. The intended shape was a
migration with the backfill inlined:

```sql
INSERT INTO "Edition" (slug, name, startAt, endAt, createdAt)
SELECT DISTINCT edition, edition, ... FROM "Course";
```

**`prisma/migrations/` cannot carry that yet.** It holds only `init_auth` and
`add_enrollment`, while the schema already contains the whole question, exam,
and file model set — those were applied with `db push` and never migrated, so
`migrate dev` wants to reset the database and a generated `add_edition`
migration would include every missing table. Rebuilding the migration history
is its own task, and doing it inside this change would bury the edition work.

So the schema went in with `db push`, and a one-off script inserted the missing
`Edition` rows: slug as the name, min/max course dates as the window, renamed by
an admin afterwards. `pnpm test` builds its database with `db push` too, so the
test suite is unaffected either way.

### The active window gates instructors, not admins

`FR-CRS-012` makes the window the rule for when courses may be created. Applied
to everyone it would break the seed — the demo courses run in `2026-1`, whose
window closed in May — and it would stop an admin from fixing a course after a
term rolls over.

So: an instructor creating a course must be inside the edition's window;
`ADMIN` and `SYSTEM` may create in any edition. Closing a window never affects
courses that already exist.

### The slug is immutable; `update` changes name and window only

Editing a slug would silently move every course URL under it, the same argument
that keeps `username` immutable. `update` accepts `name`, `startAt`, and
`endAt`.

### `delete` refuses an edition in use

The foreign key would raise anyway; the service checks first so the caller gets
"3 courses still use 2026-1" instead of a constraint error.

### Full CRUD, per `docs/design/db-service-classes.md`

`EditionService` implements `create`, `findOne`, `findMany`, `update`, and
`delete` even though this spec only needs the first three. Reading is public —
every user sees every edition, so `findOne`/`findMany` stay on the plain
interfaces — and writing is admin-only through a new `canManageEditions`
predicate, mirroring `canCreateDiscipline`.

`findMany` filters by `slugs` and by `active` (window contains now), which is
what a course-creation form needs to populate its dropdown.

## Schema

New model `Edition`. `Course.edition` → `Course.editionSlug` + relation; the
compound unique becomes `[disciplineSlug, instructorSlug, editionSlug]` over the
same columns. One migration, with the backfill above.

## Tests

- `create` rejects `26-1`, `2026-01`, and `2026-1-1`; accepts `2026` and
  `2026-1`.
- `create` rejects an instructor actor, accepts an admin.
- `create` rejects `endAt` before `startAt`.
- `update` changes the name and window; there is no path that changes a slug.
- `delete` throws while a course references the edition, and succeeds after it
  is gone.
- `findMany({ active: true })` returns only editions whose window contains now.
- `courseService.create` refuses an unknown edition; refuses an instructor
  outside the window; allows an admin outside it.
- The existing course specs and the seed still pass, since every demo course now
  resolves through a real edition row.

## Follow-up, not in this spec

- The admin UI for creating and editing editions (next spec).
- Showing `edition.name` instead of the slug in course headers — mechanical once
  the include lands, but a visual change that wants review.
