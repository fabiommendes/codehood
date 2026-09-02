# Course schedule and calendar

Requirements `dev/requirements/07-calendar.md` (FR-CAL-001 … FR-CAL-022). This
spec turns the two stub models — `TimeSlot` and `Event`, in the schema since the
initial commit and never written to — into a real schedule, and replaces the
mocked calendar in three places with data read from it.

A course's schedule has two layers. The **weekly pattern** is what a syllabus
prints: "Mon and Wed, 14:00–16:00". The **term calendar** is the dated list of
what actually happens in those hours: week 3's lecture on recursion, the
midterm, the Thursday that is a public holiday. `TimeSlot` is the first,
`Event` is the second, and every event hangs off a slot (FR-CAL-002).

## Scope

Real data:

- `TimeSlot` gains a natural key, a title, and validation; `Event` gains a kind,
  a derived exam link, an instant-plus-duration window, and a sync marker
  (see Schema).
- `src/db/exam-link.ts`, the one implementation of the exam↔event match, called
  from both sides of the relation.
- `TimeSlotService` and `EventService` in `src/db/`, full CRUD per
  `docs/design/db-service-classes.md`.
- `canViewCourseContents` / `courseContentsVisibility` and
  `canWriteCourseContent` in `src/auth/permissions.ts` — the first split between
  managing a course record and writing its content (FR-ACC-010).
- `src/utils/schedule-time.ts`: resolving an authored wall clock to an instant,
  and rendering an instant in the server zone. No Prisma import, so it
  unit-tests without a database.
- `/calendar`, aggregating the viewer's courses (FR-CAL-021), replacing the
  hardcoded March mock.
- `/<discipline>/<course>/schedule`, the course's own term calendar
  (FR-CAL-020), grouped by week.
- The schedule section on the course home page, currently a mock array at the
  top of `index.astro`.
- `manage import-calendar`, because the CLI does not exist yet and the web UI is
  never allowed to author content (`00-overview.md`, non-goals).
- Demo schedule data in `ensureDemoCourses`, so the pages have something to
  render and screenshots have something to show.

Out of scope, deliberately:

- **REST sync endpoints.** `PUT`/`DELETE` on slots and events, and the manifest,
  belong to the content-sync spec (roadmap 0.2.0). This spec picks the natural
  keys and the manifest marker those endpoints need, and stops there.
- **Any web authoring UI.** No calendar editor, ever — the repository is the
  only source. The web app reads.
- Deadlines that are not class meetings, ICS export, room/location fields,
  attendance, and per-user time zones. All noted as follow-up.

## Design decisions

### An event is an instant plus a duration

This is the decision the rest of the model hangs off, and the one most worth
arguing with.

`Event` currently holds `start DateTime` / `end DateTime`. It becomes an
instant and a length:

```prisma
startAt     DateTime  /// when the meeting starts, stored UTC (FR-NFR-020)
durationMin Int       /// how long it runs, in minutes
```

A meeting happens at one moment for everybody, the same way an exam window does
(FR-EXAM-020), so it is stored the way FR-NFR-020 requires every timestamp to be
stored: UTC at rest, rendered in the server's configured zone (FR-CAL-022). No
second convention, no string dates, and no conversion between the calendar and
the exam it links to — both are instants, so overlap is a comparison rather than
a translation.

An end column is not stored. Duration is what the author knows ("a two-hour
lab"), it is what `Exam` already carries as `durationMs`, and an end derived
from a stored start can never disagree with it. `durationMin`, not `durationMs`,
because a class is scheduled in minutes and nobody authors 7200000.

`TimeSlot` follows the same shape one level up. It is a weekly pattern with no
date, so its start stays minutes-since-midnight, and its end becomes a duration:

```prisma
day         Weekday
startMin    Int   /// minutes since 00:00 in the server zone, 14:30 -> 870
durationMin Int
```

**The consequence to accept, stated plainly:** a stored instant is resolved
against the server zone at write time. If the zone setting changes, or a term
spans a daylight-saving boundary that the authoring tool resolved differently
from what the instructor meant, the rendered clock time moves. The fix is a
re-push — the repository holds the authored wall clock and is the source of
truth (FR-SYNC-004), so re-resolving is exactly what a push does. What this buys
in exchange is that one column answers "when", ordering and range queries are
plain SQL comparisons, and nothing in the codebase has to know two ways of
spelling a time.

### One conversion helper, and nothing formats a time without it

`src/utils/schedule-time.ts`:

```ts
export const SERVER_TZ: string;   // process.env.TZ ?? "America/Sao_Paulo"

/** Resolve an authored wall clock to an instant. Used by writers, never by readers. */
export function toInstant(date: string /* YYYY-MM-DD */, minutes: number): Date;

/** Render an instant in the server zone — FR-CAL-022's only implementation. */
export function formatDateTime(instant: Date, opts?): string;
export function formatTime(minutes: number): string;   // 870 -> "14:30"
export function localDateOf(instant: Date): string;     // for grouping a month grid
export function weekdayOf(instant: Date): Weekday;      // for the slot-agreement check
export function endOf(startAt: Date, durationMin: number): Date;
```

Built on `Intl.DateTimeFormat` with an explicit `timeZone`, so no dependency is
added. Writers call `toInstant` once; readers call the formatters.

The rule this enforces: no calendar code calls `toLocaleDateString` or
`toLocaleTimeString` without a `timeZone`. That mistake is already in the
codebase twice, caught only because the admin tables pinned it to `"UTC"` after
rendering "Jan 31" for February 1st. Grouping a month grid by day is
`localDateOf`, not `instant.getDate()`, for the same reason.

### A time slot has an authored slug, so moving the hour is an edit

```prisma
model TimeSlot {
  id       Int      @id @default(autoincrement())
  courseId Int
  course   Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)

  /// Authored: `mon`, `wed-lab`. Stable when the hour changes.
  slug     String
  /// Optional label for the syllabus line: "Lecture", "Lab".
  title    String?

  day         Weekday
  startMin    Int
  durationMin Int

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events Event[]

  @@unique([courseId, slug])
  @@unique([id, courseId])
}
```

Identifying a slot by `(courseId, day, startMin)` would have made a time change
a delete-and-create under FR-SYNC-011, which would orphan or destroy every event
attached to it. A slug authored in the course file survives "the room got moved
to 16:00", and the events keep pointing at it.

`title` exists so the course page can print "Lecture · Mon 14:00–16:00" from the
slots alone, without reading a single event. That is the syllabus line, and it
is the only thing a course with a published pattern but no calendar yet can
show.

### The composite unique pins an event to one course

`@@unique([id, courseId])` on `TimeSlot` exists so `Event` can carry `courseId`
*and* have the database guarantee it agrees with its slot's course:

```prisma
timeSlot TimeSlot @relation(fields: [timeSlotId, courseId], references: [id, courseId])
```

`Event.courseId` is denormalized on purpose. Every read is course-scoped —
visibility (`courseContentsVisibility`), the aggregated `/calendar` query, the
sync natural key `(course, slug)` — and routing all of them through
`timeSlot: { courseId }` costs a join on every access check and makes the
uniqueness of an event slug *within a course* unenforceable. The composite
foreign key buys back the consistency the denormalization would otherwise cost.

At implementation time, verify Prisma accepts `courseId` participating in both
relations. If it refuses, drop the composite key and assert the invariant in
`EventService.create`/`update` instead; everything else in this spec is
unchanged.

### The model is `CalendarEvent`; the domain word stays "event"

`Event` is a DOM global. A page that imports the row type shadows it, and
`(e: Event)` on a click handler two lines later type-checks against the wrong
thing. The model, the service type, and the imports become `CalendarEvent`; the
UI, the glossary, the requirements prose, and the URL keep saying "event". The
table has no rows, so the rename costs one line in `07-calendar.md`'s schema
impact section.

### `EventKind` replaces `isHoliday`, with the ten authored values

```prisma
enum EventKind {
  LECTURE  LAB  EXAM  REVIEW  SEMINAR  PROJECT  SELF_STUDY
  HOLIDAY  RECESS  CANCELLED
}
```

Exactly FR-CAL-011. A cancelled or suspended meeting keeps its title and
description (FR-CAL-012) — that is why the kind replaces the boolean instead of
joining it: "what would have happened" is the title, and the kind is what became
of it.

The service exports `isMeeting(kind)`, true for the first seven. The UI uses it
for badge styling and struck-through rows; the course page uses it to count
meetings held.

**Answering the open question in `07-calendar.md`:** no `OFFICE_HOURS`,
`WORKSHOP`, or guest-talk value in V1. Office hours are recurring and undated —
they are a `TimeSlot` with `title: "Office hours"` and no events, which the
syllabus line already renders. A workshop is a `SEMINAR` until someone
complains. Adding a kind later is an enum value plus a badge color.

### Week numbers are authored, and so are the times

`week Int` is required and never derived (FR-CAL-015). A holiday carries the
week it displaced, so the weeks around it do not renumber.

`startAt` and `durationMin` are required on the event, and default *at write
time* from the slot when the author gives only a date: the slot supplies the
hour and the length, and `toInstant` resolves them. They are not read through
the slot on every query, because ordering by "the event's own time, or its
slot's if null" cannot be expressed in a Prisma `orderBy`, and because a lab
that ran long is a property of that meeting.

Moving a slot therefore does not move its existing events. That is correct
here rather than merely convenient: the repository is the source of truth
(FR-SYNC-004), the CLI plans the change, and a schedule change that should
move thirty meetings arrives as thirty writes. The server does not infer them.

### An event's day must fall on its slot's weekday

`EventService` rejects an event whose `startAt`, read in the server zone, lands
on a Tuesday when its slot says `MONDAY`. It is the typo this model is most
exposed to, and nothing downstream would catch it — the calendar would just show
a Monday lecture on a Tuesday. `weekdayOf(startAt)` is the check, which is the
one place a stored instant has to be read back as a local day.

The escape hatch for a genuine one-off — a Saturday makeup class, an exam in a
hall at 08:00 — is to author a slot for it. That is what FR-CAL-002 already
requires ("events detached from the weekly schedule are not representable"), so
this rule only makes the requirement enforced rather than assumed. Second thing
in this spec worth arguing with.

### The exam link is derived from the clock, never authored

`examId Int?`, on any kind of event, not just `EXAM` (FR-CAL-013). It is not an
input on either side. `CreateEvent` and `UpdateEvent` have no `exam` field, and
neither will the exam's; the column is maintained by the services.

**Answering the second open question:** an exam and an event match when they
belong to the same course and their intervals overlap at any point.

```ts
// Both half-open, so adjacency is not overlap: an exam starting at 16:00 does
// not match the class that ended at 16:00.
const eventEnd  = endOf(event.startAt, event.durationMin);
const examStart = exam.scheduledAt;
// The exam's window is scheduledAt + durationMs + extraTimeMs — FR-EXAM-020.
const examEnd   = new Date(+examStart + (exam.durationMs ?? 1) + exam.extraTimeMs);

const matches =
  exam.courseId === event.courseId && examStart < eventEnd && examEnd > event.startAt;
```

`extraTimeMs` is part of the window by FR-EXAM-020, so it is part of the match.
It is also writable from the web app at any time (FR-EXAM-022), which makes it
the third field that triggers a relink, alongside `scheduledAt` and
`durationMs`.

The instructor authors the exam's schedule once, in the exam, and every calendar
row it touches lights up on its own. Asking them to also write `exam: midterm`
into the calendar file would be asking them to state the same fact twice in two
files, and the second statement is the one that goes stale.

Both sides are stored as instants, so an exam window that runs past midnight or
across two days matches the meetings it covers with no conversion at all. This
is the first thing the storage decision above pays for.

An exam with a null `durationMs` — scheduled but pending manual approval — is
treated as a one-millisecond interval, so the single predicate above gives it
the containing event and nothing else. A null `scheduledAt` matches nothing, and
clears any link it held.

### Overlap is many-to-one, and a tie is broken by the clock

Interval overlap is not single-valued in either direction, and the two
directions resolve differently.

**Several events, one exam.** A three-hour exam covering both of Monday's
meetings links from both rows. `examId` is on the event, so this needs nothing
extra, and it is the right reading: the exam does occupy both meetings, and both
calendar rows should say so.

**Several exams, one event.** Two quizzes inside one two-hour class both overlap
the same event, and FR-CAL-013 gives the event a single nullable `examId`. The
tie-break is the earliest `scheduledAt`, then the lowest `id` — deterministic,
and it names the exam a student walking into that room meets first. The cost:
the second quiz gets no calendar row of its own, which the instructor can fix by
authoring the meeting as two slots. Widening the column to a join table is a
requirements change (FR-CAL-013 says `examId`), so it is a follow-up, not a
decision taken here.

This is where the earlier no-overlap rule on time slots stops carrying the
argument. It still keeps a course's weekly pattern sane, but it no longer makes
the match unique, because uniqueness now depends on the exams, not the slots.
The tie-break is what makes the result deterministic.

### Both sides relink, in the writing transaction

`EventService.create` and `.update` resolve the event's window and set `examId`
to the exam it overlaps, or to null. `ExamService.create` and `.update` do the
mirror image whenever `scheduledAt`, `durationMs`, or `extraTimeMs` changes. Both run inside the
caller's transaction, so an event never observes a link to an exam that moved in
the same write.

One implementation, in `src/db/exam-link.ts`, imported by both services:

```ts
/** The exam this event overlaps, applying the tie-break. */
export async function examForEvent(tx, event): Promise<number | null>;

/** Recompute `examId` on every event this exam could have touched. */
export async function relinkExam(tx, examId): Promise<void>;
```

`relinkExam` does not push the exam onto its events. It collects the events that
could have changed — those currently pointing at the exam, plus those whose
window overlaps its new one — and runs `examForEvent` on each. One rule, one
implementation, evaluated from the event's side in both directions; an exam
moving off a row that another exam also overlaps therefore hands that row to the
second exam rather than blanking it.

Candidates are one indexed range query: events in the course whose `startAt`
falls between the exam's new start minus the longest meeting and its end. No
widening, no in-memory filtering pass — which is the second thing the storage
decision pays for.

A standalone module rather than a method on either service, because
`exam.service.ts` and `event.service.ts` would otherwise import each other.
`ExamService` does not exist yet — exams are their own spec — so this spec ships
`examForEvent`, ships `relinkExam` with tests against exam rows written
directly, and leaves a one-line call for the exam spec to add.

Doing it on both sides is what makes push order irrelevant. A sync is not atomic
and may be resumed (FR-SYNC-005): if the exam lands first, its relink finds no
events and does nothing, and each event's own create finds the exam when it
arrives; if the calendar lands first, the exam's relink closes the loop. Either
order converges on the same rows, which is FR-SYNC-003's idempotence read across
two resources.

`scheduledAt` is frozen from `ONGOING` onwards (FR-SYNC-033), so relinking stops
when the exam starts. Nothing re-links on a clock tick; there is no job.

The two times still disagree legitimately — an exam that opens fifteen minutes
before the room does is a real thing an instructor may want — so
`/<course>/schedule` shows the instructor, and only the instructor, an inline
warning when a linked exam's window is not fully covered by the events it
overlaps. Under start-instant matching that warning caught one case; under
overlap it catches the useful one, an exam running into hours the class does not
have.

`EventService` still nulls the exam link out of what it returns to a student
when the linked exam is `DRAFT` or `ARCHIVED`. The link is computed for
everybody — it is a fact about the schedule — but a calendar row must not leak
the existence and title of an unpublished exam, which is precisely what
`ExamStatus.DRAFT` means to prevent.

### `contentHash` is the manifest marker, and the CLI computes it

```prisma
contentHash String  /// opaque, supplied by the writer; the server never computes it
```

FR-SYNC-002 needs a modification marker per content item, and
`03-content-sync.md` leaves open what it is for events. `updatedAt` does not
work: re-pushing an unchanged event would bump it and the next diff would show
churn forever.

So the hash is **supplied on every write and stored verbatim**, exactly as
`QuestionData.versionHash` already is (FR-QST-011). It is a required field on
`CreateEvent` and `UpdateEvent`, opaque to the server, echoed back in the
manifest, and never parsed, validated for shape, or recomputed. What it hashes
is the CLI's business — the file, most likely, since that is what the CLI
actually diffs.

A server-computed hash would have to agree, byte for byte and forever, with
whatever the CLI hashes locally. Every field the server canonicalizes
differently, every field the file carries that the row does not, and every
future schema change becomes a false diff on a file nobody edited. The server
cannot see the file, so it cannot win that argument; the writer holds the only
copy of the truth, and the marker belongs to it.

This also settles `examId` for free. The link is derived, and the CLI cannot
know it — so it cannot be in the hash, and rescheduling an exam can never make
a calendar file look dirty to the tool that has no change to push.

`manage import-calendar` computes a hash over each event's YAML block before
calling the service. It stands in for the CLI, and a client computing its own
marker is precisely the behaviour being rehearsed.

This answers the open question for events. Exams and files still need their own
answer, in their own specs.

### Reads follow course contents; writes follow ownership alone

Two new permission pairs in `src/auth/permissions.ts`:

```ts
canViewCourseContents(actor, course)   // + courseContentsVisibility(actor)
canWriteCourseContent(actor, course)
```

`canViewCourseContents` is, today, exactly `canViewCourse`: system, admin,
instructor-owner, or an `ACTIVE` enrollment. It gets its own name now because
FR-CRS-030 will widen `canViewCourse` to "any authenticated user may see a
course exists", and on that day every calendar call site must keep the narrow
rule. Renaming later means finding them; naming now means not having to.

`canWriteCourseContent` is `SYSTEM` or the course's own instructor, and the
actor's role is not consulted at all:

```ts
export function canWriteCourseContent(actor: Actor, course: { instructor: { id: number } }): boolean {
  return actor === SYSTEM || course.instructor.id === actor.id;
}
```

Per FR-ACC-010, `ADMIN` carries no override here. That is not a rule *against*
admins — an admin who teaches a course passes this check like anyone else,
because they are its instructor, and the check never asks what their role is.
What the role stops buying is authority over somebody else's course.

**A course has exactly one manager: its instructor.** An admin who does not
teach it has no Manage tab, no schedule writes, and no course operations —
`02-courses.md`'s "Who sees what" table reads `Admin, other → Manage: no,
Interact: no`. What FR-ACC-011 leaves them is authority over records that are
not a course: disciplines, editions, accounts, and archival, all exercised from
`/admin`, never from inside a course. Reading is the one thing a non-owner admin
keeps here — the same table grants them `See Contents: yes`, which is why
`canViewCourseContents` admits them and no write predicate does.

This is why neither predicate can reuse `canManageCourse`, which short-circuits
on `actor.role === "ADMIN"`. That one stays, and stays scoped to the course
*record* it guards for `/admin/courses`; course operations belong to
`canManageEnrollment` and content to `canWriteCourseContent`, and neither has an
admin branch — see the predicate table in
`dev/specs/to-do/course-navigation.md`. Written here for the calendar and reused
by questions, exams, and resources.

Both services implement the `*As` interfaces, so a call site that forgets its
actor fails to compile.

### Two services, both full CRUD

`TimeSlotService` and `EventService`, not one `CalendarService`: each model is a
REST resource with its own natural key, and a method missing here is a missing
endpoint later (`docs/design/db-service-classes.md`). `TimeSlot` is not a join
table — events reference it — so it does not fold into `CourseService` the way
`Enrollment` did.

What the non-obvious methods mean:

- `timeSlotService.delete` refuses a slot that still has events, naming the
  count, the way `editionService.delete` refuses an edition in use.
- `timeSlotService.update` changes `title`, `day`, `startMin`, `durationMin`.
  Not `slug` — it is the sync identity, and changing it is a delete plus a create
  (FR-SYNC-011).
- `eventService.delete` removes the row outright. Events are never archived
  (FR-CAL-014), because nothing references them the way a response references a
  question.

`EventService.findMany` carries the filters both views need:

```ts
interface FindEventsBy {
  courseIds?: number[];
  from?: Date;           // inclusive; events whose window ends at or after it
  to?: Date;             // exclusive; events starting before it
  kinds?: EventKind[];
  weeks?: number[];
  limit?: number;        // for "the next three meetings" on the course page
}
```

Ordered by `startAt`, which is one indexed column rather than a compound sort. With no `courseIds`, it returns everything the
actor may see — which is what `/calendar` wants, and why the visibility fragment
has to be a `where` and not a filter applied afterwards.

No overlap rule across slots is enforced at creation beyond the obvious ones
(`durationMin > 0`, `startMin` within `0..1439`, `startMin + durationMin` not
past midnight, and no two slots in one course sharing a weekday with overlapping
minutes). Two courses colliding on a student's
own timetable is real, but it is the student's problem to see, not the server's
to refuse — `/calendar` shows both.

### `manage import-calendar`, shaped like the sync payload

Until the CLI lands there is no way to get a schedule in, and the web app is
never getting one. The command takes the course and a YAML file:

```yaml
slots:
  - slug: mon
    title: Lecture
    day: MONDAY
    start: "14:00"
    duration: 120

events:
  - slug: w01-intro
    slot: mon
    date: 2026-03-02
    week: 1
    kind: LECTURE
    title: Course overview and tooling
    description: Setting up the toolchain; how the term is graded.
  - slug: w03-midterm
    slot: mon
    date: 2026-03-16
    start: "14:30"      # optional; omitted means the slot's hour
    duration: 90        # optional; omitted means the slot's length
    week: 3
    kind: EXAM
    title: Midterm
```

The file is authored in wall clock — a date and a clock time — and the command
resolves each one to an instant through `toInstant` before calling the service.
That is where the conversion belongs: at the boundary, in the writer, once.

No `exam:` key: the midterm links itself, because its window overlaps that
Monday afternoon.

`--prune` deletes events not named in the file; without it, the import is
additive and updates in place by slug. It runs as `SYSTEM` through the services,
like every other `manage` command.

The file shape is deliberately the shape the sync endpoints will accept, so this
command is a rehearsal of that contract rather than a throwaway: when 0.2.0
lands, the REST handler parses the same document and the command keeps working.

### The three views

`/calendar` (FR-CAL-021) — a real month grid for the viewer's courses, navigated
with `?month=YYYY-MM`, defaulting to the current month in the server zone. Each
day cell lists its events with a per-course color dot; the "Upcoming" section
below becomes the next five events from today. Empty months say so rather than
rendering an empty grid with no explanation.

`/<discipline>/<course>/schedule` (FR-CAL-020) — the term, grouped by authored
week, each row showing time, kind badge, title, description, and a link to a
linked exam. Non-meeting kinds render muted, `CANCELLED` struck through with the
original title intact.

It is named `schedule`, not `calendar`, so that `/calendar` — my week across
every course — and this page — one course's term — do not sit one path segment
apart under the same word. It is the Schedule tab in
`dev/specs/to-do/course-navigation.md`. `docs/design/url-structure.md` gains a
line for it, and no reserved-name check is needed because only top-level
segments collide.

Course home page — the mock array goes; the schedule section shows the syllabus
line from the slots plus the next three events, linking to the course's own
Schedule tab rather than to `/calendar` as it does now. Both "preview data"
alerts come out.

Nobody sees any of this without `canViewCourseContents`; a course with no slots
shows "No schedule published yet — the instructor pushes it with the CLI."

## Schema

```prisma
enum Weekday { SUNDAY MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY }

enum EventKind {
  LECTURE LAB EXAM REVIEW SEMINAR PROJECT SELF_STUDY HOLIDAY RECESS CANCELLED
}

model TimeSlot {
  id       Int    @id @default(autoincrement())
  courseId Int
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  slug  String
  title String?

  day         Weekday
  startMin    Int
  durationMin Int

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events CalendarEvent[]

  @@unique([courseId, slug])
  @@unique([id, courseId])
}

model CalendarEvent {
  id       Int    @id @default(autoincrement())
  courseId Int
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  timeSlotId Int
  timeSlot   TimeSlot @relation(fields: [timeSlotId, courseId], references: [id, courseId])

  slug String

  startAt     DateTime
  durationMin Int
  week        Int

  kind        EventKind @default(LECTURE)
  title       String
  description String?

  /// Derived, never authored: the exam whose window overlaps this one.
  examId Int?
  exam   Exam? @relation(fields: [examId], references: [id], onDelete: SetNull)

  /// Supplied by the writer, opaque to the server. See the manifest decision.
  contentHash String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([courseId, slug])
  @@index([courseId, startAt])
}
```

Changed from what is in the schema today: `WEEKDAY` → `Weekday` (Prisma
convention, matching `Role` and `ApiKeyKind`); `TimeSlot` gains `slug`, `title`,
timestamps, and the two unique keys, and its `endMin` becomes `durationMin`;
`Event` becomes `CalendarEvent`, keeps an instant but as `startAt` +
`durationMin` instead of `start`/`end`, and swaps `isHoliday Boolean` for
`kind`, plus `courseId`, `examId`, `contentHash`, and timestamps.
`Course.schedule` keeps its name and gains `events CalendarEvent[]`; `Exam`
gains `events CalendarEvent[]`.

There is no `@@unique([timeSlotId, date])`. "One meeting per slot per day" is a
real rule and SQLite cannot express it over an instant without a stored day
column, which is the redundancy this shape exists to avoid — so
`EventService.create` enforces it with a range query over the event's local day,
and the test suite pins it.

Both tables are empty in every environment, so this is a create, not a
migration with data to carry. It applies with `db push` like the rest of the
schema — `prisma/migrations/` still holds only `init_auth` and `add_enrollment`,
and rebuilding that history is its own task (see `editions.md`).

`courseInclude` does **not** gain the schedule. Course cards and listings do not
show it, and a join per card to serve one page is the wrong trade; the two pages
that need slots ask `timeSlotService` for them.

## Tests

`test/schedule-time.spec.ts`, no database:

- `toInstant` resolves the same wall clock to different instants on either side
  of a spring-forward boundary in a DST zone (`America/New_York`), and
  `localDateOf` maps both back to the day they were authored on.
- `formatTime` pads (`540` → `"09:00"`); `formatDateTime` renders in `SERVER_TZ`
  and not in the process default; `weekdayOf` reads an instant near midnight as
  the local day, not the UTC one.
- `endOf` adds minutes, and an event crossing midnight ends on the next local
  day.

`test/time-slot-service.spec.ts`:

- `create` rejects `durationMin <= 0`, a `startMin` outside `0..1439`, a slot
  running past midnight, and a second slot overlapping an existing one on the
  same weekday in the same course.
- `create` rejects a duplicate slug in one course, accepts the same slug in
  another.
- `update` moves the hour; the slot's existing events keep their own times —
  pinning the no-cascade decision.
- `delete` throws while events reference the slot, naming the count, and
  succeeds once they are gone.
- An instructor may write their own course's slots; another instructor gets
  `ForbiddenError`; an admin who does not teach the course gets `ForbiddenError`
  (FR-ACC-010, and the one place this diverges from `canManageCourse`); **an
  admin who is the course's instructor may write it**, since the check reads
  ownership and never the role.

`test/calendar-event-service.spec.ts`:

- `create` given only a day fills `startAt` and `durationMin` from the slot, and
  keeps explicit values when given.
- `create` rejects a slot belonging to another course, and an event whose
  `startAt` falls on a different weekday than its slot.
- `create` rejects a second event on the same slot on the same local day — the
  rule the dropped `@@unique` used to carry.
- `create` rejects a missing `contentHash`; `update` stores the supplied one
  verbatim and the service never derives, normalizes, or rewrites it.
- `delete` removes the row; a subsequent `findOne` returns null (no archive).
- `findMany` includes an event that starts before `from` but is still running at
  it, excludes one starting exactly at `to`, filters by kind and by week, and
  orders by `startAt` across courses.
- A student enrolled in one of two courses sees only that course's events; a
  dropped student sees none; the instructor sees their own.
- The agreement test between `canViewCourseContents` and
  `courseContentsVisibility`, following the pattern in
  `test/course-service.spec.ts`.
- A student's event carries `exam: null` when the linked exam is `DRAFT`; the
  instructor's carries the exam.

`test/exam-link.spec.ts`, the overlap rule in both directions:

- An exam starting inside an event's hours matches; one that starts before and
  ends inside matches; one that spans the event entirely matches.
- Adjacency does not match, at either edge: an exam starting exactly at the
  event's end, and one ending exactly at its `startAt`.
- `extraTimeMs` extends the match: an exam that ends before the next meeting
  links to one event, and links to two once extra time pushes it past the
  boundary — with the relink firing on that write (FR-EXAM-020, FR-EXAM-022).
- An exam with a null `durationMs` matches the event containing its instant, and
  one with a null `scheduledAt` matches nothing and clears the link it held.
- A three-hour exam over two consecutive meetings links from **both** events.
- Two exams inside one event: the earlier `scheduledAt` wins, and the tie at
  equal instants falls to the lower id.
- `update` moving an event out of the exam's window clears the link; moving it
  back restores it. `relinkExam` moves the link when the exam moves, and hands a
  vacated event to a second overlapping exam rather than blanking it.
- An exam window crossing midnight matches the meetings on both days.
- The two push orders converge: exam-then-event and event-then-exam leave
  identical rows.
- An exam in another course is never matched, even at the same instant.
- Neither relink touches `contentHash` — a derived link never perturbs the
  writer's marker.

`test/permissions.spec.ts` gains `canWriteCourseContent` cases for `SYSTEM`, the
owning instructor, a non-owning instructor, a student, an admin who does not
teach the course, and an admin who does — the last pair being the point of the
predicate.

Evidence to collect: screenshots of `/calendar` with two seeded courses in one
month, `/cs101/ada_2026-1/schedule` showing a holiday and a cancelled class in
their weeks, and the course home page schedule section — all from
`ensureDemoCourses` data, not fixtures written for the screenshot.

## Follow-up, not in this spec

- **REST sync endpoints and the manifest** for slots and events (0.2.0). The
  natural keys and `contentHash` are chosen here for them.
- **ICS export** per course and per user, at `/<course>/schedule.ics`. `toInstant`
  exists for it. Wants an unguessable per-user token, since calendar clients do
  not carry session cookies — a threat model of its own.
- **A re-resolve command.** Changing the server time zone leaves stored
  instants where they were; a `manage retime-calendar` that re-resolves every
  event from its authored wall clock would close it without waiting for a push.
  Not built, because a zone change is a once-ever event and a re-push already
  fixes it.
- **Deadlines that are not meetings** — an assignment due at 23:59 has no slot
  and is not representable (FR-CAL-002 as written). If V1 wants them, that is a
  requirements change, not an implementation detail.
- **More than one exam per event.** `examId` is singular by FR-CAL-013, so two
  quizzes in one meeting surface only the first. A join table would fix it and
  is a requirements change, not an implementation choice.
- **Room and location** on `TimeSlot`, once anyone asks.
- **A weekly grid view** (hours down, weekdays across) as an alternative to the
  month grid. The data supports it; the month grid ships first.
- Glossary: the `Time slot` and `Event` entries change — `Event` gains its kinds
  and its `CalendarEvent` code name, `Time slot` gains the slug and title.
