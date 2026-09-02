# Course tabs, and where the instructor's tools live

Two changes that turn out to be one. The course pages get a tab strip in place
of their back-link, and the instructor's tools stop living behind a separate
"instructor view" and become extra tabs on the same pages everyone else uses.

They are one change because the tab strip is what makes the second possible.
Today an instructor reaches the roster by going to the course, clicking
"Instructor view →", then clicking "Roster" — three pages deep, through a screen
whose only job is to be a menu. With six tabs, every destination is one click
from every other, and the menu page has nothing left to do but hold the things
that are genuinely course administration.

## Scope

- `src/utils/course-tabs.ts` — the tab list as a pure function of course and
  actor, so the visibility rule is unit-testable without rendering anything.
- `CourseHeader.astro` — badge, title, instructor line, and the tab strip, on
  every course page.
- `ui/Tabs.astro` gains horizontal overflow, since six tabs do not fit a phone.
- Every page under `/<discipline>/<course>/`: `index`, `exams`, `resources`,
  `schedule` (new, from `calendar.md`), `roster`, `manage`, `gradebook`.
- `loadCourse` returns the course's `href`, deleting the same five lines from
  eight pages.
- `/manage` becomes real: the course record form, the enrollment tools, and the
  sync panel.
- Where the exam operations go — "Start exam now", "Snooze", "Release results"
  (FR-EXAM-011, FR-EXAM-012, FR-EXAM-022). Placement and rules only; the exam
  pages themselves stay mocked. `/<course>/invite` folds into `/roster` and stops existing.
- `/roster` becomes the Students tab: the real table on `ui/Table.tsx`, with a
  drop control (FR-CRS-042).
- Both halves of FR-CRS-042: the instructor's drop control and the student's own
  `Leave course`, sharing one action and one predicate.
- `canManageEnrollment` and `canDropEnrollment` in `src/auth/permissions.ts`,
  narrowing course operations to the course's owner and to the student
  themselves.

Out of scope: the exam and gradebook screens themselves (they stay mocked until
questions render), the passphrase join flow (FR-CRS-041 — `PassphraseService`
does not exist), and course archival, which is an admin action on the record
(FR-CRS-024) and already belongs to `/admin/courses`.

## Design decisions

### The tabs

```
Home        /<discipline>/<course>
Exams       /<discipline>/<course>/exams
Resources   /<discipline>/<course>/resources
Schedule    /<discipline>/<course>/schedule
─────────── everyone above, the course's instructor also sees:
Students    /<discipline>/<course>/roster
Manage      /<discipline>/<course>/manage
```

The instructor's two tabs are appended, never interleaved. A student and an
instructor looking at the same course see the same first four tabs in the same
four positions, so "it's the third tab" is a sentence that works in a lecture
hall. The strip is the only navigation on the page: the `← My courses`
back-link goes, and so does the `Instructor view →` link opposite it. The
sidebar already carries `My courses` and a link per enrolled course, so nothing
becomes unreachable.

Two labels deliberately do not match their paths, for opposite reasons.
**Students** points at `/roster` because "roster" is the glossary term and the
name every service method already uses (`listStudents` sits on it, not the other
way round); renaming the route would ripple through docs to save a word nobody
types. **Schedule** points at `/schedule`, and here the path changes: the
calendar spec named this sub-route `/<course>/calendar`, which would have put
two different things one path segment apart — `/calendar` is *my* week across
every course, and this is *one course's* term. Renaming it while both specs are
unbuilt costs one line in `calendar.md`.

Gradebook does not get a tab. The list above is the whole strip; the gradebook
is reached from the Exams tab, where an instructor is already looking at the
exam whose submissions they want. A seventh tab for a screen that only makes
sense next to a specific exam would be a worse trade than one link in a header.

### No modes. What you see is what you may do

This is the rule the rest of this spec follows, so it is worth stating in full:

**A page never has a mode.** No "Edit Mode", no "Admin Mode", no "Instructor
view" badge, no toggle that changes what a URL means. Every control on every
page is shown when the viewer may use it and absent when they may not, decided
per control by the same predicates the services enforce.

What this costs today, all of which this spec pays:

- The `Instructor view` badges on `/manage`, `/roster`, and `/gradebook` are
  deleted. They announce a mode that does not exist — the instructor did not
  switch into anything, they clicked a tab.
- `/manage` stops being *the instructor's version of the course page*. There is
  one course home page. An instructor opening it sees the same layout as their
  students, plus the things only they can act on.
- Draft exams appear inline in the course's own exam list for the instructor,
  carrying a `Draft` badge, rather than on a parallel screen. Same list, same
  URL, more rows.

And what it rules out, deliberately: a **"preview as student"** toggle. It is the
most tempting mode of all, and it is a mode. The reason it is not needed is the
rule itself — the instructor's page differs from the student's only by controls
that are visibly marked as theirs, so "what do they see?" is answered by
ignoring the marked parts. If that ever stops being true, the fix is that the
page has drifted, not that it needs a preview button.

The one thing this rule does not promise is that every URL opens for everybody.
`/manage` and `/roster` still 403 for a student (FR-CRS-033). A tab they cannot
open is not shown to them, so they do not meet the 403 by clicking.

### The tab list is a pure function, and the guard is the same predicate

```ts
// src/utils/course-tabs.ts — no Astro, no Prisma imports.
export type CourseTabKey =
  | "home" | "exams" | "resources" | "schedule" | "students" | "manage";

export function courseTabs(
  course: CourseWithEnrollment & CourseRef,
  actor: Actor,
): readonly TabItem[];
```

Two reasons it is not written inline in the component. It makes the visibility
rule testable without a browser — the only part of this spec that *can* be
tested — and it puts the rule in one place, where it can be pinned to the page
guard.

That pinning is the invariant worth naming: **a visible tab never 403s.**
`courseTabs` appends the instructor's two tabs exactly when
`canManageEnrollment(actor, course)` is true, which is exactly the check
`loadCourse({ manage: true })` runs on the pages behind them. Same predicate,
one call each, asserted by a test — the `canViewCourse`/`courseVisibility`
pairing pattern applied to a tab strip instead of a `where` clause.

### That predicate is new, and it is not `canManageCourse`

`canManageCourse` returns true for any admin. The "Who sees what" table in
`02-courses.md` does not: **Admin, other** reads `Manage: no` and
`Interact: no`, and only the course's owner — instructor *or* admin — gets
`Manage: yes`. An admin who does not teach the course has no business
generating its invites or dropping its students.

So the pages and the tabs behind them move onto a new predicate, written next to
the one it narrows:

```ts
/** Course operations: enrollment, invites, /manage, /roster. Owner only. */
export function canManageEnrollment(actor: Actor, course: CourseWithEnrollment): boolean {
  return actor === SYSTEM || course.instructor.id === actor.id;
}
```

`canManageCourse` keeps its admin branch and keeps its job — the course
*record*, which is what `courseService.update` guards and what an admin needs
for archival (FR-CRS-024, FR-ACC-011). That authority is exercised from
`/admin/courses`, where the admin already is, not from a course's Manage tab.

Three adjacent predicates, and the boundaries between them are exactly the
splits the requirements draw:

| Predicate | Covers | Admin, not the owner |
| :--- | :--- | :--- |
| `canManageCourse` | the course record, archival | yes (FR-ACC-011) |
| `canManageEnrollment` | enrollment, invites, `/manage`, `/roster` | no (FR-CRS table) |
| `canWriteCourseContent` | questions, exams, calendar, resources | no (FR-ACC-010) |

An admin who does not own the course therefore sees four tabs, like any other
non-enrolled viewer with reading rights, and keeps every power FR-ACC-011 names.
An admin who *does* teach a course sees six, because they are its instructor —
the same ownership rule as everywhere else, never a role check.

### `CourseHeader.astro`, not `CourseTabs.astro`

The strip never appears without the course's name above it, so shipping them
separately would only give every page a chance to assemble them differently.
One component takes `{ course, active }` and renders the discipline badge, the
title, the instructor line, and the tabs.

It wraps `ui/Tabs.astro` in link mode, exactly as `AdminTabs.astro` does — the
same strip, the same underline, the same active styling, in the third section of
the app to need one. `active` is an explicit prop typed as `CourseTabKey`, so a
typo is a compile error rather than a strip with nothing highlighted; nested
routes like `/exams/midterm/[n]` pass `"exams"` and stay lit.

`ui/Tabs.astro` gains `overflow-x-auto` on the strip in link mode. Five admin
tabs already crowd a narrow phone and six course tabs overflow it outright. A
scrolling strip is the daisyUI-native answer and it keeps one navigation
pattern; a dropdown at a breakpoint would be a second one.

### `loadCourse` hands back the href

Eight pages open with the same block:

```ts
const href = courseHref({
  disciplineSlug: course.disciplineSlug,
  username: course.instructor.username,
  edition: course.editionSlug,
});
```

`loadCourse` already has the course and already owns the parse half of this
round trip, so it returns `{ course, href }` and the block is deleted eight
times. `CourseHeader` takes the course and calls `courseHref` itself for the tab
targets.

### What is left on Manage, once nothing is a mode

If the instructor's exams, schedule, and resources are on the ordinary tabs,
`/manage` needs a reason to exist. It has one: everything about the course that
is not its content.

**The course record.** Description, start date, end date — an editable form,
built from `courseService.update`, which already exists and already refuses
anyone but the instructor.

This is deliberately not a violation of the standing non-goal that *the web UI
never authors content* (`00-overview.md`). Content is what the repository owns
and the CLI pushes: questions, exams, calendar events, resources — addressed by
natural keys, listed in the manifest, and re-pushable. The course record is none
of those. It has no natural key, appears in no manifest, and is created by
`manage create-course` rather than by a push. Editing it in the browser is the
same act as editing your profile, and the alternative today is an
`update-course` command that nobody has written. If a future `course.yaml` ever
carries the description, this decision is what gets revisited — and the revisit
is "the field becomes read-only here", not a redesign.

**Enrollment.** The classroom-invite generator moves here from
`/<course>/invite`, which stops existing: it was one form and a copy button
behind its own URL and its own back-link. Alongside it, the invites this course
has outstanding, with revoke — `InviteService.findMany`/`delete` land in the
admin spec, and this is their second caller. The passphrase join flow
(FR-CRS-041) belongs on this panel too and is out of scope until
`PassphraseService` exists.

**Sync status.** What the CLI last pushed, and how much of it. Mocked behind an
explicit alert until 0.2.0, like the exam panels, because the manifest it reads
is specified in `03-content-sync.md` and not yet built.

Nothing else. No danger zone — archival is an admin action on the record
(FR-CRS-024), and it lives in `/admin/courses` where the admin already is.

### Students reuses the admin table, not a hand-written one

`/roster` currently hand-writes `<table>`, `<thead>`, and a row loop.
`ui/Table.tsx` exists, is generic over its row type, and is already the basis of
four admin tables. The roster becomes a fifth caller:

```tsx
<StudentsTable students={students} courseId={course.id} client:load />
```

Columns: name, username, school id, enrolled since, and a drop control calling
`courseService.unenroll` through a new `course.dropEnrollment` action — the same
action the student's own control calls, see below.

The invite panel is a link from here to the Manage tab rather than a duplicate
of the form. Two tabs, one form, one place to fix it.

### A student drops their own enrollment

FR-CRS-042 requires that **both** the student and the instructor can drop an
enrollment. Only half of that exists today: `canManageCourse` guards
`courseService.unenroll`, so a student cannot leave a course they joined, and
the only way out is to ask the person who invited them.

**One action, gated per actor.**

```ts
// src/auth/permissions.ts
export function canDropEnrollment(
  actor: Actor,
  course: CourseWithEnrollment,
  userId: number,
): boolean {
  return actor === SYSTEM || canManageEnrollment(actor, course) || actor.id === userId;
}
```

`course.dropEnrollment({ courseId, userId })` is the only path, and `userId`
defaults to the caller. The instructor's control in the roster table and the
student's control on their own course page post to the same action, which
applies the same rule — two actions differing only in who they admit is exactly
the shape where a call site picks the wrong one. `courseService.unenroll` moves
from `canManageCourse` onto `canDropEnrollment`.

**The control lives on Home, at the bottom, and nowhere else.** A student
deciding to leave is looking at the course, so that is where the control is: a
short enrollment block under the last section — "You joined on 12 March" and a
`Leave course` button. Deliberately not on the `/courses` cards, where a
destructive control repeated down a list of twelve courses is a mis-click
generator, and not on Manage, which a student cannot open.

**It confirms, and the confirmation states what is actually lost.** A daisyUI
`<dialog class="modal">`, naming three consequences, because FR-CRS-043 is
harsher than "leave course" sounds:

- Access to everything in the course ends immediately — including the student's
  own past submissions (FR-CRS-043).
- Nothing is deleted. The submissions stay, the instructor keeps seeing them in
  the gradebook (FR-CRS-044), and they are retained indefinitely
  (FR-NFR-040/041).
- Rejoining restores access, but needs a new classroom invite or a live
  passphrase (FR-CRS-040) — the student cannot undo this alone.

That last line is the honest framing of what kind of action this is: reversible
in the data, not reversible by the person taking it.

**FR-CRS-043 needs no new enforcement.** `courseVisibility` already filters
`enrollments: { some: { userId, status: "ACTIVE" } }`, and `courseInclude` loads
only `ACTIVE` enrollments, so `canViewCourse` stops returning true the moment
the row flips. The access rule is one status change, not a sweep — which is why
this spec adds a control and a predicate and touches no visibility code.

**After dropping**, the student is redirected to `/courses` with a confirmation
message. Reopening the course URL should land on the teaser (FR-CRS-031); until
that page exists it renders the 403, which is the same behaviour a
never-enrolled student already gets and is on the teaser's follow-up list, not
this one's.

Three cases the rule settles by not special-casing them:

- **Dropping mid-exam.** No block. Access ends at once, the submissions already
  made are kept and still count for the instructor, and the unanswered exam
  scores zero (FR-GRD-051). Blocking would mean an exam window can trap a
  student in a course.
- **Dropping twice.** A `DROPPED` enrollment dropped again is a no-op, not an
  error — the action is idempotent, so a double-submitted form or a stale tab
  cannot produce a failure the student has to interpret.
- **An instructor leaving their own course.** `Course.instructor` is not an
  enrollment, so there is nothing to drop. An instructor who is *also* enrolled
  in a colleague's course drops that enrollment like any student, and their own
  course is untouched.

### Exam operations live on the exam, not on a control panel

FR-EXAM-002 makes lifecycle transitions, extra time, and result release
*server-side operations* that the repository may not set. FR-EXAM-022 goes
further: `extraTimeMs` "MUST be writable only from the web app" and "MUST NOT be
reachable from the CLI or the REST API". So the web UI is not merely a
convenience for these — it is the only legal path, and until it exists the
requirement is unimplementable.

They belong on the exam they act on, in the Exams tab and on the exam's own
page, next to the status they change. Not on Manage: a "course operations" panel
listing every exam with its buttons is a control room, and a control room is a
mode with a table in it.

**Start exam now** — FR-EXAM-011. Shown only on a `SCHEDULED` exam, to its
course's instructor. It performs the `SCHEDULED → ONGOING` transition
immediately, overriding `scheduledAt`, which also stamps every question's
version (FR-EXAM-013) in the same transaction. It confirms first, naming what
becomes irreversible: a closed exam may not be reopened (FR-EXAM-014), and from
`ONGOING` the schedule fields freeze (FR-EXAM-023, FR-SYNC-033) so the
repository and the database disagree permanently — the case FR-SYNC-034 exists
to keep from making the course unpushable.

**Snooze** — FR-EXAM-020's `extraTimeMs`, presented as what an instructor
actually says: "give everyone another 10 minutes". Shown on a `SCHEDULED` or
`ONGOING` exam. It adds minutes to `extraTimeMs` rather than setting it, so
pressing it twice is two extensions and not a silent overwrite, and the exam
page shows the running total and the resulting close time.

Snooze is class-wide by design, never per student — per-student timing is a
deferred non-goal (`00-overview.md`), and the per-person lever is reopening one
response (`Response.acceptingSubmissions`, FR-EXAM-014). The control says
"everyone" on it so nobody goes looking for the student picker.

Extending an exam moves its window, so it relinks its calendar event in the same
transaction (`dev/specs/to-do/calendar.md`); an exam snoozed past the end of its
meeting starts overlapping the next one, and the schedule shows it.

**Release results** — FR-EXAM-012's `CLOSED → COMPLETED`, which must be an
explicit instructor action and must never happen on a timer. Same placement,
same rule.

Three properties all of these share, which is why they are one decision:

- They are `USER`-kind operations. A `CLI` key must be refused
  (FR-EXAM-022, and the ceiling in `dev/specs/to-do/permissions-actor.md`), and
  so must an admin who does not teach the course.
- They are gated by `canManageEnrollment` — the course-operations predicate, not
  the content one. Pushing an exam is content; starting it is an operation.
- The buttons are absent, not disabled, for anyone who may not press them, and
  absent for statuses where they mean nothing. A disabled button that never
  enables is a mode indicator wearing a different hat.

**Out of scope here, and stated so the gap is visible:** this spec places the
controls and names their rules; it does not build the exam pages they sit on,
because those need question rendering. The actions
(`exam.startNow`, `exam.snooze`, `exam.releaseResults`) and the lifecycle
transitions behind them belong to the exam slice. What this spec fixes is that
they had nowhere to live.

### Everything else on the course pages is reuse, not new components

`SectionHeader`, `ListRow`, `Alert`, `Card`, `Badge`, and `Button` already carry
these pages. The instructor's additions are rows and controls inside them, not a
parallel component set:

| Instructor sees, inline | Rendered with |
| :--- | :--- |
| Draft exams in the exam list | existing `ListRow` + a `Draft` `Badge` |
| Submission counts on an exam row | the `trailing` slot `ListRow` already has |
| "Push with the CLI" empty states | `Alert`, the variant the mocks already use |
| Drop / revoke controls | `Button`, in a table cell |

If a control needs a component that does not exist yet, it belongs in
`components/ui/` and in the `/design` showcase, available to admin and student
screens too — not in a `components/instructor/` folder, which is a mode with a
directory instead of a badge.

## Tests

`test/course-tabs.spec.ts`, pure, no database:

- A student enrolled in the course gets exactly `home`, `exams`, `resources`,
  `schedule`, in that order.
- The course's instructor gets those four followed by `students`, `manage` —
  asserting the shared four keep their positions.
- An instructor who does not teach the course gets four; **an admin who does not
  teach it gets four**; an admin who does gets six; `SYSTEM` gets six.
- **The pinning test:** for each of those actors, `courseTabs` includes the
  `manage` tab if and only if `canManageEnrollment` returns true for the same
  pair. This is the invariant that keeps a visible tab from 403ing, and it is
  the reason the list is a function.
- Every `href` is the one `courseHref` builds, so the tabs cannot drift from the
  URL scheme.

`test/permissions.spec.ts` gains the two new predicates:

- `canManageEnrollment` is true for the owning instructor and `SYSTEM`, false
  for a non-owning admin — the row that separates it from `canManageCourse`,
  which stays true there.
- `canDropEnrollment` is true for the owning instructor, true for the student
  dropping themselves, and false for a student naming somebody else's `userId`
  — the case that turns a self-service control into a way to expel a classmate.

`test/course-service.spec.ts` gains the drop paths:

- The instructor drops a student: the enrollment is `DROPPED`, and the student's
  `findOne` on the course stops returning it (FR-CRS-043, satisfied by the
  existing `ACTIVE` filter rather than new code).
- **The student drops themselves**, with the same outcome, which is the half of
  FR-CRS-042 that does not exist today.
- A student naming another student's `userId` gets `ForbiddenError`, and the
  other enrollment is untouched.
- A non-owning admin gets `ForbiddenError`.
- Dropping an already-`DROPPED` enrollment succeeds and changes nothing.
- Re-enrolling a dropped student flips the row back to `ACTIVE` and access
  returns, including to the submissions made before the drop — the claim the
  confirmation dialog makes to the student.

Evidence, per the workflow: screenshots of the same course URL as a student and
as its instructor, side by side, showing four tabs versus six and no badge or
banner announcing a mode; the Manage tab with its three panels; the Students tab
with the drop control; the student's own `Leave course` block and its
confirmation dialog; and the strip at 375px wide, scrolling rather than
wrapping.

## Documentation to update in the same change

- `docs/design/url-structure.md`: add `/<course>/schedule`, remove
  `/<course>/invite`, and note that the gradebook is reached from Exams.
- `dev/specs/to-do/calendar.md`: the course calendar sub-route is `/schedule`.
- `GLOSSARY.md`: `Course URL` gains its sub-route list; no new term — "tab" is
  not domain vocabulary, and "instructor view" should stop being.

## Follow-up, not in this spec

- The passphrase join panel on Manage, once `PassphraseService` exists
  (FR-CRS-041).
- The teaser page for a non-enrolled viewer (FR-CRS-030/031), which needs a tab
  strip of its own — one tab, or none. It arrives with the course-visibility
  change, not here.
- An archived-course banner (FR-CRS-034), which sits above the strip and applies
  to every tab.
- Sync status wired to the real manifest, with 0.2.0.
- Keyboard navigation across the strip (arrow keys, `role="tab"` semantics
  beyond the markup daisyUI gives). It applies to `AdminTabs` and `DesignLayout`
  equally, so it is one accessibility pass over `ui/Tabs.astro`, not a course
  change.
