# Changelog

## Unreleased

### Added

- Every course page (`/`, `/exams`, `/resources`, `/schedule`, `/roster`,
  `/manage`) now shares one tab strip (`CourseHeader.astro`, built on the pure
  `courseTabs()` in `src/utils/course-tabs.ts`) instead of a back-link. Everyone
  sees Home/Exams/Resources/Schedule; the course's owner additionally sees
  Students and Manage, gated by a new `canManageEnrollment` predicate that,
  unlike `canManageCourse`, does not grant a non-owning admin course
  operations. There is no more "Instructor view" badge or a `/manage` page
  shaped differently from what a student sees — an instructor's extra controls
  are just the tabs and rows only they can act on. See
  `dev/specs/to-review/course-navigation.md`.
  - `/manage` is now real: the classroom-invite generator and
    outstanding-invite list with revoke (moved off the now-gone
    `/<course>/invite`), a passphrase generator (below), and a mocked
    sync-status panel linking out to the question-bank preview. There is no
    course-record edit form — description and term dates come from the CLI
    push, not the browser.
  - A "Passphrase" option alongside the classroom invite link on `/manage`'s
    Enrollment panel (FR-CRS-041): `PassphraseService.create` generates a
    6-character code (or takes the instructor's own override), live for 5
    minutes, course-owner-only via the new `canManageEnrollment` predicate.
    `course.generatePassphrase` is the action; there is no management UI for
    an existing one — it expires on its own, or the instructor generates a
    new one.
  - `/roster` becomes the Students tab: a real `StudentsTable` (SolidJS, on
    `ui/Table.tsx`) with GitHub id, school id, enrollment date, and a
    confirm-cancel-drop dialog per row.
  - A student can leave a course themselves from Home ("Leave course", with a
    confirmation naming what's lost) — the missing half of FR-CRS-042. Both
    the instructor's drop control and the student's own button call the same
    `course.dropEnrollment` action, gated by a new `canDropEnrollment`
    predicate.
  - `/schedule` is a new tab holding the mock weekly-schedule card that used
    to sit on the course home page.
  - The Exams tab now shows a course's `DRAFT` exams inline (with a `Draft`
    badge and a submission count) to its instructor only, instead of on a
    separate preview panel.
- Course schedules and calendars, per `dev/specs/to-review/calendar.md`
  (FR-CAL-001…022). `TimeSlot` (the weekly pattern) and `Event` → `CalendarEvent`
  (the term calendar) go from unused stub models to the real thing: `TimeSlot`
  gains a slug, title, and overlap/window validation; `CalendarEvent` gains a
  `kind` (replacing `isHoliday`), an instant-plus-duration window
  (`startAt`/`durationMin`), a derived `examId`, and a CLI-supplied
  `contentHash`. `TimeSlotService` and `EventService` are new, full-CRUD,
  course-content-scoped services (`canWriteCourseContent` for writes,
  `canViewCourseContents` for reads — both promoted out of `canViewCourse` for
  reuse here and by resources/questions/exams). `src/db/exam-link.ts` is the one
  implementation of the exam↔event overlap match (`examForEvent`/`relinkExam`),
  shared by both sides of the relation; `Exam` gains `extraTimeMs` for it.
  `src/utils/schedule-time.ts` is the one place a wall clock resolves to an
  instant and back, so nothing else calls `toLocaleDateString`/`toLocaleTimeString`
  without an explicit time zone. `manage import-calendar` is the only way
  schedule data gets written (plus the demo seed) — there is still no web
  authoring UI. `/calendar` (a real month grid, `?month=YYYY-MM`), the course's
  own `/schedule` tab (grouped by authored week, holidays muted and cancelled
  meetings struck through), and the course home page's schedule preview now all
  read this data instead of a hardcoded mock.
- Academic editions: `Edition` is now an admin-managed table (slug, display
  name, and a window saying when new courses may be created for it) instead of
  a free string on `Course`. `EditionService` implements the full CRUD set;
  reads are public, writes are admin-only, and the slug is immutable because it
  appears in every course URL. Adds `manage create-edition` and an
  `/admin/editions` page (list with a live/closed badge and course count per
  edition, create, inline window editing, and delete guarded against editions
  still in use). See `dev/specs/to-review/editions.md`.
- The admin section (`/admin`, `/admin/users`, `/admin/courses`,
  `/admin/disciplines`, `/admin/editions`) is fully built out, per
  `dev/specs/to-review/admin-view.md`:
  - `/admin` is the overview: counts across the instance, and the
    system-wide actions an admin can't reach anywhere else — invite an
    instructor (`auth.createPersonalInvite` with `role: INSTRUCTOR`, the
    generated link shown once with a copy button, since only its hash is
    stored), create a discipline or edition inline, and a pending-invites
    list with a `admin.revokeInvite` confirm dialog per row.
  - `/admin/users` (moved off `/admin`) gets a "Force logout" column: a
    confirm dialog per row, then `admin.forceLogout` calls
    `sessionService.delete({ userId })` — every session for that account
    ends immediately, the account itself isn't disabled. An "Add new user"
    dialog also lets an admin register an account directly (name, email,
    username, role, GitHub/school id, password), instead of only inviting
    one — see Changed for the `canCreateUser` policy change this rests on.
  - `/admin/courses`: every course across every discipline, read-only —
    discipline, edition, instructor, active headcount, term dates, and a
    link to the course itself. No admin action lives here on purpose:
    admins have no authority over course content or records, only
    visibility, until archiving lands (`FR-CRS-024`).
  - `/admin/disciplines`: create, rename, and delete disciplines —
    `admin.createDiscipline`/`updateDiscipline`/`deleteDiscipline` are thin
    wrappers over the existing `DisciplineService`, so slug validation,
    reserved-name rejection, and the "N course(s)/question(s) still use it"
    delete guard are all enforced (and worded) by the service, not
    duplicated in the action.
  - All five pages share an `AdminTabs` component
    (`src/components/AdminTabs.astro`) — every tab now points at a real
    page — and a single `adminMiddleware`
    (`src/middleware/admin.ts`) guards `/admin` and everything under it,
    replacing the two-line check that used to live at the top of each page.
- `GET /api/health`: an unauthenticated liveness/readiness probe for uptime
  monitors and orchestration systems. Confirms the server can reach the
  database, not just that the process is up. See
  `docs/design/url-structure.md`.
- OpenAPI 3.0 documentation for the REST API at `/openapi.json` (`pnpm
  openapi` to regenerate; runs automatically before `pnpm build`), generated
  with `@asteasolutions/zod-to-openapi` from the same Zod schemas
  `/api/auth/cli-login` and `/api/health` validate requests against, so the
  spec and the validation can't drift apart. Browsable as Swagger UI at
  `/api/docs`, self-hosting its `swagger-ui-dist` assets rather than pulling
  them from a CDN. See `docs/design/openapi.md`.
- Authentication and registration of new users: invite-only accounts (personal
  single-use invites and reusable classroom join codes), Argon2id password
  hashing, session-cookie login for the web app, and API-key login for the
  CLI/grading bots. Admin accounts are bootstrapped via `manage create-user`
  (or automatically in dev). See `docs/implemented/auth.md`.
- User profile page (`/profile`): edit your own name, email, GitHub id, and
  school id (username is shown but not editable); change your password; log
  out of every session; manage your own CLI/bot API keys (create, list,
  revoke). See `docs/implemented/profile.md`.
- Courses: `/courses` lists what you take and what you teach; a course's
  page (`/<discipline>/<username>_<edition>`) shows its real title,
  instructor, description, and enrolled headcount; instructors get a real
  `/manage` and `/roster` (with student names, usernames, and emails); the
  classroom-invite flow enrolls the invited student in the real course
  instead of a hardcoded id. `CourseService` and `DisciplineService` join
  the access-controlled services, with a new `Enrollment` table backing
  visibility (who teaches a course, or holds an `ACTIVE` enrollment in it).
  `manage create-course` creates a course (and its discipline, if new) —
  the only way in until the CLI sync lands in 0.2.0. The schedule, exams,
  gradebook, and resources sections stay mocked, deliberately, and labelled
  as preview data on screen. See `dev/specs/to-review/courses.md`.
- Design system: a custom daisyUI theme (colors and radii matching the
  existing brand mark), a Space Grotesk/IBM Plex Sans/IBM Plex Mono type
  system, four page layouts (`Layout`, `AppLayout`, `CenteredLayout`,
  `DesignLayout`), reusable UI components (`Button`, `Badge`, `Alert`,
  `Card`), and a `/design/*` showcase (Typography, Colors, Layouts,
  Elements; Forms is a stub, deliberately not built out yet). The existing
  pages (home, login, invite-acceptance, profile) were refactored onto the
  new layouts and components rather than left as unused scaffolding.
- Course resources are real: `/resources` renders a course's files, links,
  notes, and snippets from the database, grouped into four fixed sections
  (Files, Links, Notes, Snippets) sorted by title, replacing the "Preview
  data" mock. `ResourceService` and `FileService` implement the full CRUD set
  (`src/db/resource.service.ts`, `src/db/file.service.ts`); reads use two new
  predicates, `canViewCourseContents`/`courseContentsVisibility` and
  `canWriteCourseContent` (`src/auth/permissions.ts`) — the latter has no
  admin branch (FR-ACC-010). `File` is content-addressed by a sha-256 of its
  bytes (`slugHash`), which doubles as the URL token
  (`/files/<slugHash>/<name>`) and the on-disk path; identical bytes dedupe
  into one row shared across courses, and `ResourceService.delete` is
  reference-counted so removing a resource never removes bytes another
  resource still points at. A removed blob keeps its `File` row as a
  tombstone (`File.deletedAt`) and the route answers `410` naming what it can
  instead of `404`. The blob route serves with an allowlist (not a blocklist)
  for `inline` vs. `attachment`, always with `X-Content-Type-Options:
  nosniff`, and with no authentication check by design — FR-NFR-030 is
  amended accordingly in `dev/requirements/08-nonfunctional.md`, since a
  content hash is not "unguessable". Notes (`MD`) render server-side with
  `markdown-it`, `html: false`; snippets (`CODE`) render with Shiki using
  `extra` as the language, falling back to plaintext, at their own page
  (`/resources/<slug>`). `manage import-resources` imports a YAML manifest
  shaped like the future sync payload, additive by default or `--prune`ing
  what isn't named; `ensureDemoCourses` seeds one resource of each type. See
  `dev/specs/to-review/resources.md`.

### Changed

- `src/db/api-key.service.ts` now follows `user.service.ts`'s pattern: its Zod
  schemas (`apiKeySchema`, `apiKeyCreate`, `apiKeyCreateResult`, `apiKeyPK`,
  `apiKeyFilter`, plus a branded `ApiKeyId`) live in `src/db/schemas.ts`, and
  `create`/`findOne`/`findMany` are decorated with `@Validate({ service: true,
  returns: ... })` / `@Arg(...)` against those schemas instead of validating
  (or not validating) fields by hand. `validate(token, opts?)` and `revoke(id,
  opts)` are left as plain, undecorated methods — their only inputs are bare
  primitives (a token string, a numeric id), not one of the models above, and
  `@Arg`/Zod is for validating meaningful domain shapes, not primitives; a
  `service: true` decorator on `validate` would also be wrong regardless,
  since `opts` is optional there and it isn't actor-gated (validating a token
  is how the caller's identity gets established in the first place). No
  call-site changes were needed. Verified with a standalone `tsx` script
  against a real SQLite test DB (Playwright still can't load this file — see
  `dev/issues/arg-decorator-breaks-playwright-test-transform.md`), covering
  create/findOne/findMany/validate/revoke, `@Arg` input validation, and
  `ForbiddenError` enforcement.
- `src/db/course.service.ts` now follows the same `user.service.ts` pattern,
  and implements the new `Crud<T>` interface from `src/db/base-service.ts`
  instead of composing `Create`/`FindOne`/`FindMany`/`Update` by hand. Its Zod
  schemas (`courseSchema`, `courseCreate`, `courseUpdate`, `coursePK`,
  `courseFilter`, `courseEnrollInput`, `courseRef`, plus a branded
  `CourseId`) live in `src/db/schemas.ts`; `courseSchema` mirrors the
  `courseInclude` shape (discipline, edition, instructor, active enrollments,
  `_count`). `create`/`findOne`/`findMany`/`update`/`delete`/`enroll`/
  `unenroll` are decorated with `@Validate`/`@Arg`; `listStudents(courseId,
  opts)` keeps its bare-`number` parameter undecorated (same reasoning as
  `apiKeyService.revoke`) but still validates its return shape. `update` and
  `delete` now go through `this.findOne()` first, so they accept the same
  `id`-or-`ref` `CoursePK` the read side does, rather than `id` only.
  `coursePK.id` and `courseEnrollInput`'s ids are plain numbers, not the
  branded `CourseId`/`UserId`: they're sourced from places that never carry
  the brand (a coerced action input, `Invite.courseId`), so branding them
  would have broken those call sites. The exported type is now `Course` (was
  `CourseWithDetails`) to match `user.service.ts`'s naming, which renamed two
  external references (`src/utils/load-course.ts`,
  `src/components/CourseHeader.astro`). Verified with a standalone `tsx`
  script against a real SQLite test DB, covering create/findOne (by id and by
  ref)/findMany/update/delete/enroll/unenroll/listStudents, `@Arg` input
  validation, and `ForbiddenError` enforcement for every write and read path.
- `src/db/discipline.service.ts` and `src/db/edition.service.ts` now follow
  the same pattern too, implementing `Crud<T>`. Both entities key on `slug`
  (there's no numeric surrogate id on either model), so neither introduces a
  branded id — `disciplinePK`/`editionPK` are plain `{ slug }`, and the DB
  row already matches its Zod schema exactly, so neither service needs a
  `toX()` converter. `findOne`/`findMany` on both stay permission-free (an
  optional `opts`, as before) and use `@Validate({ async: true, returns })`
  instead of `service: true` — `service: true` assumes `opts` is always
  present, which would break the moment it's called without one (see
  `dev/issues/validate-ts-error-type-and-footguns.md`); `create`/`update`/
  `delete` are actor-gated and keep `service: true`. The slug-format and
  reserved-name checks (`DISCIPLINE_SLUG_RE`/`RESERVED_SLUGS`/`EDITION_RE`)
  and the `startAt < endAt` window check stay hand-written in the method
  body rather than moving into the Zod schema, so their existing, specific
  error messages are unchanged — only the request shape is Zod-validated.
  Verified with a standalone `tsx` script against a real SQLite test DB,
  covering create/findOne/findMany/update/delete on both services, `@Arg`
  input validation, and each business-rule rejection (bad slug, reserved
  slug, bad window).
- `src/db/schemas.ts` reordered (Discipline and Edition now precede Course,
  since Course embeds both) and de-duplicated: `courseSchema`'s nested
  `discipline`/`edition`/`instructor` shapes are no longer redefined inline —
  they now reuse `disciplineSchema`, `editionSchema`, and
  `userSchema.pick(...)` directly.
- `src/db/passphrase.service.ts` now follows the same pattern, implementing
  `Crud<T>`. Its Zod schemas (`passphraseSchema`, `passphraseCreate`,
  `passphraseUpdate`, `passphrasePK`, `passphraseFilter`, plus a branded
  `PassphraseId`) live in `src/db/schemas.ts`; every method is decorated with
  `@Validate`/`@Arg`. `update`/`delete` now go through `this.findOne()`
  first (needed to accept the same `id`-or-`value` `PassphrasePK` union
  `findOne` does — the `Crud<T>` interface requires one shared `pkFilter`
  type across all four), same as `course.service.ts`. `passphraseSchema`'s
  `courseId` is the branded `CourseId` (it's always DB-sourced on output),
  but `passphraseCreate`/`passphraseFilter`'s `courseId` stays a plain
  number (sourced from a coerced action input), the same asymmetry as
  `coursePK`/`courseEnrollInput`. Verified with a standalone `tsx` script
  against a real SQLite test DB, covering create (generated and
  explicit-value paths, plus the collision case)/findOne (by id and by
  value)/findMany (course-scoped and system-wide)/update/delete, `@Arg`
  input validation, and `ForbiddenError` enforcement for every gated path.
- `src/db/invite.service.ts` and `src/db/file.service.ts` now follow the same
  pattern.
  - `invite.service.ts` keeps composing `Create`/`FindOne`/`FindMany`/
    `Update`/`Delete` by hand rather than `Crud<T>` — like `api-key.service.ts`,
    its methods don't share one entity shape: `create` returns
    `{ token, invite }`, `findOne`/`update` return the row plus its
    redemption `_count` (`InviteWithCount`), and `findMany` adds `createdBy`
    on top of that (`InviteListItem`) — expressed as a `inviteSchema` →
    `inviteWithCount` → `inviteListItem` chain of `.extend()`s mirroring the
    original type hierarchy. `findOne` keys on `token` (the credential
    itself); `update`/`delete` key on a separate, plain-number `invitePK`
    (`{ id }`, sourced from a coerced action input). `redeem(token, userId,
    email, opts?)` is untouched and undecorated — bare primitives, and its
    `opts` isn't a `ServiceOpts` (no `actor`) so it can't use `@Validate`'s
    `service` mode anyway.
  - `file.service.ts` implements `Crud<T>` (`create`/`findOne`/`findMany`/
    `update`/`delete` all return the same `File`), reusing the
    `course.service.ts`-style `this.findOne()`-first shape for `update`/
    `delete` now that `filePK` is the `{ id } | { slugHash }` union
    `findOne` already supported. `fileCreate` validates `bytes` with
    `z.instanceof(Buffer)` alongside `mimeType`/`contentHash` — a multi-field
    object, not a bare primitive, so it gets the same `@Arg` treatment as
    every other create schema. `findWithReferencingTitles`/`readBlob`/
    `blobPath`/`writeBlob` (bare-primitive or filesystem-only helpers) are
    unchanged.
  - Both add a branded id (`InviteId`, `FileId`); `Invite.courseId`/
    `createdById` are branded (`CourseId`/`UserId`) on output but plain on
    `inviteCreate`/`inviteFilter`, the same input/output asymmetry as
    `coursePK`/`courseEnrollInput`.
  - Verified both with standalone `tsx` scripts against a real SQLite test
    DB (plus a throwaway `RESOURCE_ROOT` for the file blobs): invite's
    create/findOne/findMany/update/delete/redeem/checkRedeemable across
    admin/instructor/student visibility, and file's create (including the
    dedup and corrupt-upload paths)/findOne/findMany/update/delete/
    findWithReferencingTitles/readBlob, with `@Arg` input validation and
    `ForbiddenError` enforcement throughout.
- `src/db/session.service.ts`, `src/db/time-slot.service.ts`, and
  `src/db/resource.service.ts` now follow the same pattern.
  - `session.service.ts` composes `Create`/`Delete` by hand (like
    `invite.service.ts`) rather than `Crud<T>` — it has no `findOne`/
    `findMany`/`update`, and `create` returns `{ token, session }`, not the
    entity alone. `validate(token, opts?)` is unchanged and undecorated: a
    bare-primitive param, no `ServiceOpts`/actor gating, and its return
    value (the session with `user` joined) feeds `Astro.locals.user`
    directly rather than the branded `Session` shape.
  - `time-slot.service.ts` and `resource.service.ts` both implement
    `Crud<T>`, reusing the `course.service.ts`-style `this.findOne()`-first
    shape for `update`/`delete` now that their `pkFilter`s are `{ id } |
    { ref }` unions. `resourceSchema.file` reuses `fileSchema` directly
    (the same relation-reuse as `courseSchema`'s `discipline`/`edition`) —
    `Resource`'s `fileId`/`file` are branded/typed as `FileId`/`File | null`
    on output, but `resourceCreate`/`resourceUpdate`'s `fileId` stays a
    plain number. Dropped `create()`'s manual `if (!input.contentHash)`
    check — `resourceCreate`'s `contentHash: z.string().min(1)` already
    covers it, so the runtime check was fully redundant, unlike the
    business-rule checks (resource-shape-by-type, slot-window/overlap) that
    stay hand-written since Zod can't express them declaratively.
  - Both `TimeSlotWithDetails`/`ResourceWithFile` are renamed to
    `TimeSlot`/`Resource` (matching `user.service.ts`'s naming), updating
    their external references (`src/commands/import-calendar.ts`,
    `src/commands/import-resources.ts`).
  - Verified all three with standalone `tsx` scripts against a real SQLite
    test DB: session's create/validate/delete (by token and by userId);
    time-slot's create (including the window and overlap-collision
    rejections)/findOne/findMany/update/delete (including the
    still-has-events refusal); and resource's create (including each
    resource-shape rejection)/findOne/findMany/`groupResourcesByType`/
    update/delete (including releasing a shared file reference) — with
    `@Arg` input validation and `ForbiddenError` enforcement throughout.
- `src/db/calendar-event.service.ts` now follows the same pattern too —
  the last of `src/db/*.service.ts` to convert. It implements `Crud<T>`,
  reusing the `course.service.ts`-style `this.findOne()`-first shape for
  `update`/`delete` now that `calendarEventPK` is the `{ id } | { ref }`
  union `findOne` already supported. `calendarEventSchema.timeSlot` reuses
  `timeSlotSchema` directly (the include always loads the full slot); `exam`
  is its own small `linkedExamSchema` (`{ id, slug, title }`), since
  {@link maskExam} — unchanged — only ever exposes that summary, never the
  full `Exam` row, and nulls it out for a non-owner when the linked exam is
  `DRAFT`/`ARCHIVED`. Dropped `create()`'s manual `if (!input.contentHash)`
  check (redundant once `calendarEventCreate` requires it); the weekday-match
  and same-slot-same-day collision checks stay hand-written, same reasoning
  as the resource-shape and time-slot-window checks elsewhere. `isMeeting()`
  is unchanged. `CalendarEventWithDetails`/`CreateEvent` are renamed to
  `CalendarEvent`/`CalendarEventCreate` (matching `user.service.ts`'s
  naming), updating their external references
  (`src/commands/import-calendar.ts`,
  `src/pages/[discipline]/[course]/schedule.astro`). Verified with a
  standalone `tsx` script against a real SQLite test DB, covering create
  (including the weekday-mismatch and slot/day-collision rejections)/findOne
  (by id and by ref)/findMany/update (including the exam-relink and the
  startMin-without-date rejection)/delete, the exam-masking behavior for a
  `DRAFT` exam (visible to the instructor, hidden from an enrolled student),
  and `@Arg`/`ForbiddenError` enforcement throughout.
- The admin tab strip's flat underline style (`AdminTabs`) is now a generic
  `Tabs` component (`src/components/ui/Tabs.astro`) with two modes: page-linked
  tabs (what `AdminTabs` needs — each item is an `<a href>`) or same-page tabs
  driven by a radio group and named slots (what `/profile` needs). The active
  tab's highlight is a `checked:` CSS variant on the input itself, not a class
  baked in at render time, so it actually follows a click instead of freezing
  at whichever tab was active on load; panels live outside the input row and
  are shown via a generated `:has()` rule, so the strip stays one clean row
  with the underline directly beneath it instead of trailing off after all
  the (mostly hidden) panel content. `/profile` is now split into Details,
  Account (change password + log out everywhere), and API keys tabs, landing
  on whichever one the just-submitted form belongs to. Its content column was
  also still `max-w-2xl px-6` from before the tab rewrite; it's now
  `max-w-4xl px-4 py-10`, matching every other single-column app-shell page.
- `canCreateUser` now allows admins, not only `SYSTEM` — a deliberate reversal
  of `dev/specs/to-review/admin-view.md`'s original call that invite
  redemption (or the CLI) would stay the only path to an account. `/admin/users`
  is the new direct path; invites are still there for anyone who'd rather set
  their own password.
- `/admin` is now the overview page described above; the users listing that
  used to live there moved to `/admin/users`, matching the tab strip's own
  labeling and the URL every other admin page follows (`/admin/<section>`).
- Every `/admin/*` list page's table is now built from a generic `Table<T>`
  component (`src/components/ui/Table.tsx`, SolidJS) driven by a
  `columns: ColumnConfig<T>[]` prop instead of hand-written `<tr>`/`<td>`
  markup — each column names its header and a `render(row)` for the cell,
  typed against the same row type as `data`, so a page's table is data plus
  column definitions rather than repeated markup. `EditionsTable`,
  `UsersTable`, `CoursesTable`, `DisciplinesTable`, and `InvitesTable`
  (`src/components/admin/`) are the five consumers so far.
- The `<dialog>`-opening wiring for `data-open-dialog` triggers (edit/delete
  confirmations on the admin tables) moved from a per-page `<script>` into
  `AppLayout`, once, since every page that renders one of these dialogs needs
  the same three lines.
- The app shell's default content width (`AppLayout`'s single-column pages —
  calendar, courses, roster, manage, gradebook, resources, and both admin
  pages) went from `max-w-3xl` to `max-w-4xl`, closer to the width used in the
  admin section's design mockups.
- `courseService.create` no longer validates the edition string itself: it
  resolves the edition row, refuses an unknown one, and refuses an instructor
  creating a course outside that edition's active window. Admins and `SYSTEM`
  may create in a closed edition, which is what lets the seed build past terms
  and an admin fix a course after a term rolls over.
- `Course.edition` (string) is now `Course.editionSlug` plus an `edition`
  relation, mirroring `disciplineSlug`/`discipline`. Course views can show the
  edition's display name; the URL still uses the slug.
- Access control moved into the service layer instead of living in the
  Astro Actions/page callers. `UserService`, `SessionService`,
  `ApiKeyService`, and `InviteService` now require an `actor` (a real user,
  or the `SYSTEM` sentinel for trusted internal callers) on every method and
  enforce visibility themselves — listing users, issuing/revoking API keys
  and sessions, and creating invites all check the actor internally rather
  than trusting the caller to have checked first. See
  `docs/design/service-access-control.md`.

### Fixed

- `@Arg`-declared parameter decorators crashed Playwright Test's own TypeScript
  transform (a hardcoded, Stage-3-only Babel decorators plugin that has no
  parameter-decorator support at all — not a `tsconfig.json`/esbuild config
  gap), blocking `pnpm test` for nearly the whole suite. Fixed by removing
  parameter decorators entirely: `@Validate` now takes an `args: SchemaItem[]`
  option (positional Zod schemas for the method's parameters) instead of one
  `@Arg` decorator per parameter, and its implementation is a hybrid legacy /
  Stage-3 method decorator so it still runs correctly under both esbuild
  (Astro/Vite, `tsx`) and Playwright's Babel transform. All 11 service classes
  and `test/validate.spec.ts` were updated to the new `args:` form; no
  call-site validation behavior changed. See
  `dev/issues/arg-decorator-breaks-playwright-test-transform.md` (now
  resolved) and `src/utils/validate.ts`.
- `UserService.findOne`'s `@Arg`/`args` schema was `userFilter` (a
  `{usernames?, take?}` shape meant for `findMany`) instead of `userPK`;
  since Zod strips unknown keys by default, `findOne({ id })` silently lost
  the `id` and always returned `null`. Only surfaced once the fix above let
  `test/user-service.spec.ts` actually run.
- `userUpdate` was a plain (non-`strict`) Zod object, so `userService.update`
  silently dropped unexpected keys (like a smuggled `username`) instead of
  rejecting them, despite the "Username is now read-only on `/profile`"
  entry above claiming otherwise. It was also missing `email`, which
  `/profile`'s own update form always submits — undetected because the same
  non-strict stripping silently no-op'd email changes rather than erroring.
  `userUpdate` now picks `email` too and is `.strict()`.
- `src/auth/password.ts`'s `common-passwords.json` import needed an explicit
  `with { type: "json" }` import attribute for Playwright's ESM loader (a
  loader-specific requirement; Astro/Vite/`tsx` didn't need it).
- `@Arg`-declared parameter validation never actually ran on any
  `@Validate`-decorated method (`UserService.create/findOne/update/updatePassword`
  and any future consumer): TypeScript's `__decorate` helper snapshots the
  property descriptor before parameter decorators run and unconditionally
  restores that stale snapshot afterward, discarding the mutation `@Arg` relied
  on to hand its schema to `@Validate`. Input validation silently no-op'd —
  malformed input reached business logic and Prisma directly, with no error or
  warning. `src/utils/validate.ts` now records `@Arg` schemas in a side
  registry keyed by the stable class-prototype object instead of by mutating
  the method, which `__decorate` doesn't clobber; `@Arg` used without a
  matching `@Validate` now also warns instead of silently doing nothing. No
  call-site changes needed. See `test/validate.spec.ts`.
- `test/course-flow.spec.ts` logged in as `ada`/`hopper` with the wrong
  passwords (`"instructor"`/`"student"` instead of the seeded `"ada"`/
  `"hopper"`) and named the cs201 instructor's course URL by their display
  name (`turing`) instead of their username (`alan`) — every test in the file
  failed at the login step. Both were stale fixtures, unrelated to any
  behavior change; fixed so the suite actually exercises the routes it names.
- `/profile` let a user change their own username, which is the foreign key
  `Course.instructor` targets (`Course.instructorId` references
  `User.username`). Renaming silently moved every course URL that
  instructor owns, breaking existing links with no redirect. Username is
  now read-only on `/profile`, and `userService.update` rejects any
  `username` key in its update fields at runtime.
