# Rename every `User` foreign key to the `<relation>Id` convention

## Goal

Since `User` dropped its integer `id` and became keyed by `username`, the foreign keys
pointing at it are named inconsistently — `username`, `authorUsername`, `graderUsername`,
`instructorSlug`. `ApiKey` and `Invite` have already been converted to the target
convention:

> A relation field is named for the role it plays (`createdBy`, `author`, `user`); its
> scalar foreign key is that same name plus `Id` (`createdById`, `authorId`, `userId`).
> The column still *holds* a username — `username` is the user's id now — so the name says
> "id", not "username".

This spec applies that convention to the nine remaining relations.

## Scope

| Model | Relation field | Current FK | New FK |
| :--- | :--- | :--- | :--- |
| `Course` | `instructor` | `instructorSlug` (`@map("instructorRef")`) | `instructorId` |
| `Enrollment` | `user` | `username` | `userId` |
| `Session` | `user` | `username` | `userId` |
| `GroupMembership` | `user` | `username` | `userId` |
| `InviteRedemption` | `user` | `username` | `userId` |
| `Exam` | `author` | `authorUsername` | `authorId` |
| `QuestionRef` | `author` | `authorUsername` | `authorId` |
| `Response` | `author` | `authorUsername` | `authorId` |
| `Submission` | `grader` | `graderUsername` | `graderId` |

Relation field names do **not** change. Only the scalar FK does.

**Out of scope.** Do not rename `Course.disciplineSlug` or `Course.editionSlug` — those
point at `Discipline`/`Edition`, not `User`, and `slug` is genuinely those models' key
name. Do not touch `User.username` itself. Do not fix unrelated pre-existing type errors
(see "Known pre-existing breakage").

## Reference implementation

`ApiKey` and `Invite` are already done — read them first, they are the pattern:

- `prisma/schema.prisma`, `model ApiKey` and `model Invite`
- `src/db/services/api-key.service.ts` (include, create data, guards, `toApiKey`)
- `src/db/services/invite.service.ts` (`fromDb` needs no rename step once column and
  entity field agree)

## The one distinction that matters

There are two layers, and only the **database** layer is being renamed:

- **Database column** (`prisma/schema.prisma`, and every Prisma `where` / `data` /
  `select` / `include` / `orderBy` object): renamed.
- **Public entity** (`src/core/schemas.ts`, and everything a service returns): mostly
  **unchanged**. `userInfo` is `{ name, username }` and stays that way — an embedded user
  summary keeps calling the field `username`.

So a service's `fromDb`/`toX` function is where the two meet, and several of them will now
need a mapping step they did not need before (or lose one they no longer need). Getting
this backwards — renaming `userInfo.username` — is the main way to break this task.

The one exception, called out per-model below, is `apiKeyFilter`/`inviteFilter`-style
*filter* schemas, which name a column and were already renamed to match.

## Per-model notes

### `Course.instructorSlug` → `instructorId`

Highest-risk of the nine.

- The field carries `@map("instructorRef")`, so the physical column is `instructorRef`,
  not `instructorSlug`. **Drop the `@map`** so the physical column matches the field, like
  every other model here.
- `@@unique([disciplineSlug, instructorSlug, editionSlug])` →
  `@@unique([disciplineSlug, instructorId, editionSlug])`. This renames the generated
  compound accessor, so `src/db/services/course.service.ts:157`
  `disciplineSlug_instructorSlug_editionSlug` becomes
  `disciplineSlug_instructorId_editionSlug`.
- Also `course.service.ts` lines ~121 (create data), ~159, ~194 (filter where-clause).
- `courseSchema.instructor` stays `userInfo`. `fromDb` in `course.service.ts` must keep
  returning `instructor: { username, name }`.

### `Enrollment.username` → `userId`

- `@@unique([username, courseId])` → `@@unique([userId, courseId])`, so the accessor
  `username_courseId` at `course.service.ts:275` becomes `userId_courseId`. The value
  passed there is already `input.userId`, so the line simplifies to `userId: input.userId`.
- `courseInclude.enrollments.select` (`course.service.ts:~58`) selects `username` — becomes
  `userId`.
- **Trap:** `courseSchema.enrollments` is `userInfo.array()`, i.e. `{ name, username }`.
  `fromDb` currently does `username: e.username`; after the rename that becomes
  `username: e.userId`. The public field stays `username`.
- Same trap in `joinedAtFor` (`e.username === actor.username` → `e.userId === ...`) and in
  `students()` (`studentUsernames`, `studentToDate`).
- `src/auth/permissions.ts`, `interface CourseWithEnrollment` declares
  `enrollments: { username: UserId }[]`. This shape is built from **Prisma rows** in some
  call sites and from entity objects in others — check each caller and make them agree.
  Renaming it to `{ userId: UserId }[]` is correct if every caller passes a raw row;
  verify rather than assume.

### `Session.username` → `userId`

- `src/db/services/session.service.ts` lines ~61 (create data), ~121 (`deleteMany` where),
  ~132 (the local row interface), ~139 (`userId: session.username` — this mapping step
  disappears; the column is now `userId`).

### `InviteRedemption.username` → `userId`

- Stays `@unique`.
- `src/db/services/invite.service.ts` `redeem()`: the `data: { inviteId, username }`
  shorthand at ~257 must become `data: { inviteId: invite.id, userId: username }` — the
  local parameter is still called `username`, which is fine; only the column key changes.
  Update the adjacent comment that names `InviteRedemption.username`.

### `Exam` / `QuestionRef` / `Response` `.authorUsername` → `authorId`, `Submission.graderUsername` → `graderId`

- These are **schema-only**: `grep` finds no service or test referencing them today.
  `QuestionRef` also has `@@unique([slug, authorUsername, disciplineSlug])` →
  `@@unique([slug, authorId, disciplineSlug])`.
- Confirm with a fresh `grep` before assuming; if a consumer has appeared, update it.

## Procedure

1. Read the reference implementation above.
2. Edit `prisma/schema.prisma` — all nine models at once.
3. `pnpm run db:generate` (runs `prisma generate` + the branding script).
4. `pnpm exec prisma db push`.
   - Column renames are drop+add, so seeded rows lose those values. `dev.db` only.
   - If `db push` refuses or the data ends up inconsistent, run `pnpm run db:reset` to
     rebuild and reseed. **Only ever touch `dev.db`.** Do not pass
     `--accept-data-loss`; if you think you need it, stop and report instead.
5. Fix every consumer. Work model by model, using `grep` to find call sites rather than
   guessing. `rg 'authorUsername|graderUsername|instructorSlug|createdByUsername' src test`
   should end up empty outside `src/generated/`.
6. `pnpm run openapi` to regenerate `public/openapi.json`.
7. `pnpm exec biome check --write .` then `pnpm run lint` — must exit 0 for the files you
   touched (see "Known pre-existing breakage" for what will still fail).
8. `pnpm exec tsc --noEmit -p tsconfig.json` — no *new* errors under `src/`.
9. Verify at runtime (below).
10. Update `CHANGELOG.md`, then move this spec to `dev/specs/to-review/`.

## Verification — required, not optional

A green typecheck does **not** prove a column rename works. Prisma builds queries at
runtime from strings; a missed `where: { username: ... }` typechecks against a stale
generated client and then throws
`The column main.X.username does not exist in the current database`. You must exercise
each renamed relation against the real database.

**Restart the dev server after `db:generate`.** A running `astro dev` holds the old
generated client in its module cache and will 500 with "column does not exist" even after
a correct rename. This already bit us once. Use:

```
pnpm exec astro dev stop; pnpm exec astro dev --background
pnpm exec astro dev logs      # decode the JSON `message` field for stack traces
```

Seeded dev accounts (password == username): `admin`, `ada` and `alan` (instructors),
`bob`, `hopper`, `hamilton`, `liskov` (students). Log in via the Astro action — it needs a
form body and an `Origin` header:

```
curl -s -X POST http://localhost:4321/_actions/auth.login \
  -H 'Origin: http://localhost:4321' -F login=ada -F password=ada -c cookies.txt
```

Then confirm **200, not just "not 500"**, on at least:

| Route | Exercises |
| :--- | :--- |
| `/cs101/ada_2026-1` | `Course.instructorId`, `Enrollment.userId` |
| `/cs101/ada_2026-1/roster` (as `ada`) | enrollment listing, `students()` |
| `/cs101/ada_2026-1/schedule` | course visibility via enrollments |
| `/courses` | course list + instructor |
| `/admin` (as `admin`) | invites, redemptions |
| `/profile`, `/getting-started` | sessions, api keys |

Also check that `/roster` still 403s for `bob` and `admin` — a permission predicate reading
a renamed field can silently start returning the wrong answer, which a 200-only check will
not catch.

For anything without a page (`Exam`, `QuestionRef`, `Response`, `Submission`,
`GroupMembership`), write a throwaway `tsx` script under the scratchpad that creates, reads
back and deletes a row through Prisma, and run it. Delete any rows you create.

Report what you actually ran and what it returned. Do not claim a route works without
having requested it.

## Known pre-existing breakage — do not try to fix

- `pnpm run lint` already fails on unrelated files (formatting in several `.astro` pages,
  unused imports in `time-slot.service.ts`, unused vars in `typing/branding.ts`).
- `tsc` reports ~120 errors, almost all in `test/*.spec.ts`, from the earlier
  username-as-id refactor (`Property 'id' does not exist on type ...`). Under `src/` only
  two remain, both in `calendar-event.service.ts` (lines ~162 and ~167).
- Tests do not currently run (`test/*.spec.ts` is Playwright, and the suite is red from the
  same refactor). Do not use "tests pass" as your evidence; use the HTTP checks above.

If your change makes any of these *worse*, that is yours to fix. Leave the rest alone and
say so in your report.
