# `src/core/schemas.ts` is verbose and confuses optional with nullable

Two problems, same file.

## 1. Create/update schemas are retyped instead of derived

`userCreate`, `userUpdate`, `disciplineCreate`, `editionCreate` derive from
their entity schema via `pick`/`omit`/`extend`. These do not, and drift from
`xSchema` silently:

- `courseCreate`
- `passphraseCreate`, `passphraseUpdate`
- `fileCreate`, `fileUpdate`
- `timeSlotCreate`, `timeSlotUpdate`
- `resourceCreate`, `resourceUpdate`
- `calendarEventUpdate` (`calendarEventCreate` already derives)

Rewrite each as `xSchema.pick(...)` / `.omit(...)` / `.extend(...)` /
`.partial()`. Where a field genuinely differs from the entity's (`courseCreate`
takes a flat `discipline: string` where `courseSchema` has a `disciplineInfo`
object), `extend` it explicitly so the difference is visible as a difference.

## 2. `.optional()` where the column is nullable

A nullable column reached through an `.optional()` field cannot be cleared:
`undefined` reaches Prisma as "leave it alone". Every create/update field over a
nullable column must be `.nullish()` — absent means keep or default, `null`
means clear.

Already converted by `dev/specs/to-do/service-upsert.md` (the seven upsertable
entities): `courseCreate.description`, `timeSlotCreate.title`,
`resourceCreate`/`resourceUpdate`'s `description`/`data`/`extra`/`fileId`,
`calendarEventUpdate.description`. What remains is the sweep over the rest of
the file and the rule being applied to new schemas.

Carve-out: `apiKeySchema.token` and `inviteSchema.token` are legitimately
`.optional()`. They are output-shape optionality — present only in the create
response — not nullable columns. Do not "fix" them.

Rule of thumb worth recording once this lands: `.optional()` = "I am not
saying", `.nullish()` = "I can also say nothing", plain = required.

## 3. `nullSentinel` should become a real nullable column

`User.githubId` and `User.schoolId` are `String @unique` NOT NULL holding a
`!<username>` sentinel when absent, unmasked on read by `user.service.ts`. The
sentinel exists because `@unique` rejects duplicate nulls in some engines —
SQLite does not, so the column can simply be `String? @unique`. Needs a
migration plus removing `nullSentinel`/`unmask`.

## 4. Missing `.partial()`

`courseUpdate` is `courseSchema.pick({description, startAt, endAt})` with no
`.partial()`, so PATCH-ing a course demands all three fields. `disciplineUpdate`
has the same shape (moot at one field, but inconsistent).

Fixed by `dev/specs/to-do/service-upsert.md`. Remove this section once that
lands.
