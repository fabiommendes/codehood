---
type: spec
status: to-review
tags: [time-slot, calendar, rest-api, schemas]
relatedTo: [calendar.md, course-scoped-resource-api.md, course-natural-key-api.md]
---

# Time slots: clock-time fields, unified PK, course-scoped REST

Three changes to `TimeSlot`, none of them touching the database representation.
`prisma/schema.prisma` is not edited and no migration is generated: `startMin`
stays an `Int`, `@@unique([courseId, slug])` stays, `slug` stays.

1. The service exposes a wall clock (`{ hour, minute }`) instead of
   minutes-since-midnight.
2. `timeSlotPK` becomes `{ id } | { courseId, slug } | courseNaturalKey & { slug }`,
   dropping the `{ ref: ... }` wrapper.
3. REST moves from `/api/time-slot` to
   `/api/course/<discipline>/<instructor>_<edition>/time-slot`, the same
   conversion `resource` and `exam` already went through.

## 1. Clock time

New in `src/core/schemas/base.ts`:

```ts
export const clockTime = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});
export type ClockTime = z.infer<typeof clockTime>;
```

`timeSlotSchema.startMin: number` becomes `timeSlotSchema.start: clockTime`.
`durationMin` is unchanged: a duration is a quantity of minutes, not a reading
off a clock, and giving it `{ hour, minute }` would make `{hour: 2, minute: 30}`
mean 150 in one field and 02:30 in the other.

Conversion lives in `src/utils/schedule-time.ts`, the module that already owns
wall-clock/instant conversion:

```ts
export function toClockTime(minutes: number): ClockTime;
export function toMinutes(time: ClockTime): number;
export function formatClock(time: ClockTime): string;  // delegates to formatTime
```

`formatTime(minutes)` keeps its signature; `CalendarEvent.startMin` is out of
scope and still uses it.

The service maps in `fromDb` and on the way into Prisma. Validation rules keep
their meaning, expressed over the new type:

- `durationMin > 0`.
- `toMinutes(start) + durationMin <= 1440` (no slot runs past midnight).
- The `startMin in 0..1439` check is deleted: `clockTime` makes it unreachable.
- The same-day overlap check is unchanged in behaviour, computed on minutes.

Callers to convert: `src/db/bootstrap.ts` (3 slots),
`src/fixtures/time-slot.factory.ts`, `src/commands/import-calendar.ts`
(`parseClock` now returns a `ClockTime`), `src/pages/[discipline]/[course]/index.astro`,
`src/pages/[discipline]/[course]/schedule.astro`.

## 2. Primary key and course reference

Mirrors `question.ts` / `exam.ts`. In `src/core/schemas/time-slot.ts`:

```ts
timeSlotNaturalKey = courseNaturalKey.extend({ slug })

timeSlotPK = z.union([
  z.object({ id: timeSlotId }),
  z.object({ courseId, slug }),
  timeSlotNaturalKey,
])

timeSlotCreate.courseId = z.union([courseId, courseNaturalKey])
timeSlotUpsert = timeSlotCreate
timeSlotUpdate = timeSlotCreate.omit({ courseId: true, slug: true }).partial()

timeSlotFilterBase = z.object({ days: z.array(weekdaySchema).optional() })
timeSlotFilter = z.union([
  timeSlotFilterBase.extend({ courseId }),
  timeSlotFilterBase.extend(courseNaturalKey.shape),
])
```

`timeSlotRef` and `timeSlotPkRef` are removed, not kept as aliases.

A course is now **required** to list slots. Every existing caller already passes
`courseId`, and the flat route that allowed a bare `GET /api/time-slot` is gone,
so cross-course slot listing disappears on purpose. `time-slot` therefore leaves
`OPTIONAL_FILTER_RESOURCES` in `test/api-crud.spec.ts`.

`TimeSlotService` moves from the hand-rolled class to `CrudBase` with `*Tx`
methods, as `ExamService` does. Resolving a `courseNaturalKey` needs a lookup
inside the same transaction as the write, which is what `CrudBase.$transaction`
exists for. Use `courseRefWhere`, `valueOrNotFound`, `valueOrNotAllowed` and
`invalidIfExists` from `src/db/utils.ts` instead of re-deriving them.

Errors: `update`/`delete`/`findOne` on a missing slot throw `NotFound`, not a
bare `Error` (a bare `Error` reaches HTTP as a 500). A `courseNaturalKey` that
resolves to no course is `NotFound` on reads and writes alike.

Error messages that named the slug keep naming it (`This slot overlaps slot
"mon" on MONDAY`, `Slot "mon" still has 3 event(s)...`).

## 3. Course-scoped REST

```
GET    /api/course/<discipline>/<instructor>_<edition>/time-slot          list
POST   /api/course/<discipline>/<instructor>_<edition>/time-slot          create
GET    /api/course/<discipline>/<instructor>_<edition>/time-slot/<slug>   read
PUT    /api/course/<discipline>/<instructor>_<edition>/time-slot          upsert
PATCH  /api/course/<discipline>/<instructor>_<edition>/time-slot/<slug>   update
DELETE /api/course/<discipline>/<instructor>_<edition>/time-slot/<slug>   delete
```

`/api/time-slot` is removed, not deprecated. The declaration copies `examApi` in
`src/api/index.ts`: `keySegment: "/[slug]"`, `scope: courseNaturalKey`,
`key: timeSlotNaturalKey`, `create`/`upsert` with `courseId` omitted,
`filter: timeSlotFilterBase`, and the three `parse*Params` hooks built on
`parseCourseParams`.

Status codes follow the table in `src/urls/README.md`: 400 for a course segment
that does not match the grammar, 404 for no such course, 403 for a course the
actor may not read, 404 for an unknown slug. The list endpoint uses the same
table — a client naming a course it may not see gets 403, not `[]`.

Also update: `src/api/registry/hook.ts` if it lists the resource name,
`src/api/registry/route-patterns.json` (regenerate with
`scripts/generate-route-patterns.ts`), the paragraph in `src/urls/README.md`
listing `time-slot` as still flat, `BACKLOG.md`, `CHANGELOG.md`.

## Acceptance criteria

- A1 `prisma/schema.prisma` is byte-identical and no migration is added.
- A2 `timeSlotSchema.start` is `{ hour, minute }`; nothing outside
  `time-slot.service.ts` and `schedule-time.ts` mentions a slot's `startMin`.
- A3 `findOne`/`update`/`delete` accept all three PK forms;
  `create`/`upsert` accept `courseId` as an id or a natural key.
- A4 The six nested REST methods work end to end; `/api/time-slot` 404s; the
  status-code table holds; the OpenAPI document advertises the nested paths and
  carries no `courseId` query or body field for them.
- A5 Validation rules of §1 hold, and the overlap rule still rejects a second
  slot overlapping an existing one on the same weekday in the same course while
  allowing the slot's own current row through `upsert`.
- A6 `pnpm run lint` exits 0 and the suite is green.

## Testing strategy

- **Property (`vitest` + `fast-check`, new `test/clock-time.spec.ts`)**: for
  every `m` in `0..1439`, `toMinutes(toClockTime(m)) === m`; for every valid
  `{hour, minute}`, the round trip is the identity; `clockTime` rejects
  out-of-range hours and minutes. Pure functions, no database.
- **Table-driven, same file**: `formatClock` output for midnight, noon, 09:05,
  23:59.
- **Service (`test/time-slot-service.spec.ts`, rewritten)**: keep the nine
  existing scenarios and re-express them over `start`; add a PK-form matrix
  (`{id}`, `{courseId, slug}`, natural key) over `findOne`/`update`/`delete`,
  and `create`/`upsert` with `courseId` as a natural key. Reuse
  `persistedTimeSlotFactory`.
- **HTTP (`test/api-time-slot.spec.ts`, new)**: mirror
  `test/api-resource.spec.ts` — every method on the nested path, the
  status-code table, PUT idempotency, and `/api/time-slot` gone.
- **OpenAPI (`test/openapi.spec.ts`)**: nested paths present, flat path absent.

Do not write tests that only assert a type is a type, and do not re-cover the
clock-time round trip in the service tests.

## Outcome

`PUT` sits on the collection path, not on `/<slug>`: the `CRUD` helper puts
upsert there for every resource, and `resource` and `exam` already read that
way. The table above was corrected to match.

`findOne` distinguishes two misses that the spec text had bundled together. A
slug that does not exist inside a course that does returns `null`, which the
REST layer turns into a 404, as `ExamService.findOneTx` does. Only a course
reference resolving to no course throws `NotFound`.

`calendar-event.service.ts` needed one line: `calendarEventSchema` embeds
`timeSlotSchema`, so its reads had to convert the raw `startMin` through
`toClockTime` or fail output validation.

The Bruno collection under `test/bruno/time-slot/` was rewritten for the nested
paths and the `start` object. `test/bruno.spec.ts` validates it against the
OpenAPI document, so a stale collection fails the suite.
