# Handoff: service `upsert`

Full design: `dev/specs/to-do/service-upsert.md`. Read it first — this document
only states what is already done, what is left, and the acceptance criteria.

## Already done (do not redo)

`src/core/schemas.ts`

- `userSchema.githubId`/`schoolId`, `calendarEventSchema.examId`: `.optional()` → `.nullable()`.
- `courseUpdate`, `disciplineUpdate`: added the missing `.partial()`.
- Nullable-column fields in create/update widened to `.nullish()`:
  `courseCreate.description`, `timeSlotCreate.title`, `resourceCreate`/
  `resourceUpdate`'s `description`/`data`/`extra`/`fileId`,
  `calendarEventUpdate.description`.
- Deleted a dead `z.object({courseId})` that was assigned to nothing.
- New exports: `userUpsert` (= `userCreate.partial({password: true})`),
  `disciplineUpsert`, `editionUpsert`, `courseUpsert`, `timeSlotUpsert`,
  `resourceUpsert`, `calendarEventUpsert` — each `= xCreate`.

`src/core/error.ts`

- `ActionCode` is exported and gained an `upsert-*` variant.
- `NotAllowed#as(action)` returns a copy re-tagged with a different action.

`src/db/services/user.service.ts`

- `unmask()` returns `null`, not `undefined`; new `mask()` maps `null` → the
  `nullSentinel`, leaves `undefined` alone so Prisma skips the column.

`src/db/base-service.ts`

- `Upsert<In, Out>` (was `Upsert<Entity>`); `CrudT`'s `Upsert` defaults to
  `Create`; `Crud` extends `Upsert<T["upsert"], T["entity"]>`.
- The `upsert()` helper now takes `(client, service, input, opts, args, action)`,
  runs inside `opts.tx` or a fresh `client.$transaction`, probes with
  `service.findOne`, re-tags a probing `NotAllowed` via `.as(action)`, and calls
  `args.assertCreatable` **on the update branch only**.

Everything above typechecks. `pnpm run lint` and `tsc --noEmit` are clean apart
from two pre-existing `public/sw.js` errors.

## Public API being added

Seven services gain a working `upsert`, placed **directly below `update`** in
the file:

```ts
upsert(input: XUpsert, opts: ServiceOpts): Promise<X>
```

| service | key | mechanism | `action` code |
| :--- | :--- | :--- | :--- |
| discipline | `slug` | native `prisma.upsert` | `upsert-discipline` |
| edition | `slug` | native `prisma.upsert` (rewrite) | `upsert-edition` |
| user | `username` | helper | `upsert-user` |
| course | `{ref}` | helper | `upsert-course` |
| time-slot | `{ref}` | helper | `upsert-time-slot` |
| resource | `{ref}` | helper | `upsert-resource` |
| calendar-event | `{ref}` | helper | `upsert-calendar-event` |

`api-key`, `invite`, `session`, `file`, `passphrase` keep `upsert: never` and
the throwing stub, but the stub moves below `update` and gets a one-line comment
saying why (reasons in the spec's Scope section).

## Acceptance criteria

1. Upserting a key that does not exist creates the row; upserting the same key
   again updates it in place — same primary key, no second row.
2. The natural key is never mutated. An upsert whose key differs from an
   existing row creates a new row rather than renaming one.
3. Absent field = stored value kept (update branch) or column default (create
   branch). `null` = column cleared. Both observable through `findOne`.
4. Permission: create permission required always, update permission required in
   addition when the row exists. Concretely — a non-admin cannot
   `userService.upsert` an existing user they *can* `update` (their own
   profile); the refusal is a `NotAllowed` with action `upsert-user`.
5. `course.upsert` on a closed edition succeeds when the course exists and fails
   when it does not, unless the actor has `canCreateCourseOutsideWindow`.
6. `userUpsert` without `password` leaves the stored hash alone; with one, it
   resets it.
7. Every validation `create`/`update` enforces still fires through `upsert`:
   edition window, slug regex, time-slot overlap, calendar-event weekday match
   and slot-day collision, resource shape-by-type.
8. An upsert nested in a caller's `opts.tx` does not open a second transaction.

## Testing strategy

Seam: `xService.upsert(input, opts)`, observed only through `findOne`/
`findMany` on the same service. Never the helper directly, never Prisma
directly, never `NotAllowed#as` in isolation.

Location: the existing `test/<entity>-service.spec.ts` files. No new files.
Reuse each file's existing fixture helpers (`makeUser`, `makeDiscipline`,
`ensureEdition`, …) rather than writing new ones.

Shape: one happy-path test per service asserting criteria 1-3 together
(create → assert → upsert again with a changed field and a `null` → assert the
same id, the changed field, the cleared field, and an untouched field). Then
focused edge-case tests, only where the service actually differs:

- `user`: criteria 4 and 6.
- `course`: criterion 5.
- `time-slot` / `calendar-event` / `resource`: criterion 7, one test each for
  the invariant that service owns (overlap / weekday / shape-by-type).
- one service only (`time-slot`): criterion 8.

Do not write a per-service copy of an edge case that is really the shared
helper's behavior. Do not assert on types.

## Notes

- The helper's `update` mapper defaults to passing the input through; Zod strips
  the key fields the update schema does not declare. Pass an explicit mapper
  where that is not true.
- `assertCanCreateX` is worth extracting for `course` and `user`, where the
  create-side check needs a DB lookup; the other five can pass a one-line
  predicate as `assertCreatable`.
- Run tests with `pnpm test <spec file>`.
