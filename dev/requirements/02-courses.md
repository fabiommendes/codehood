# Disciplines, editions, courses, enrollment

## Disciplines

**FR-CRS-001** — A `Discipline` MUST be created by an admin. Instructors MUST
NOT create one.

**FR-CRS-002** — A discipline MUST have no owner. Any instructor MAY open a
course under any existing discipline.

**FR-CRS-003** — A discipline slug MUST match `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`
and MUST be rejected if it collides with a reserved top-level name.

**FR-CRS-004** — Adding a top-level route to the application MUST add its name
to the reserved list in the same commit, and MUST verify no existing discipline
already holds it.

> Astro resolves static routes before dynamic ones without warning. A discipline
> slugged `login` does not error — it silently makes every course under it
> unreachable.

## Editions

**FR-CRS-010** — `Edition` MUST be a table managed by admins, not a free string
on `Course`.

**FR-CRS-011** — An edition MUST have a URL slug, a display name, and a required
active window (`startAt`, `endAt`).

**FR-CRS-012** — The active window MUST gate *course creation only*. Courses
already created MUST be unaffected when the window closes.

**FR-CRS-013** — An edition slug MUST match `^[0-9]{4}(-([1-9][0-9]*|0))?$` and
MUST NOT contain an underscore.

> No leading zero on the term number, so `2026-1` and `2026-01` cannot both
> exist and address different courses. No underscore, because the course URL
> segment splits on it.

## Courses

**FR-CRS-020** — A course MUST be uniquely identified by
`(discipline, instructor, edition)`, and its URL MUST be
`/<discipline-slug>/<username>_<edition-slug>` with no `/courses/` prefix.

**FR-CRS-021** — A malformed course segment and a well-formed segment naming no
course MUST both render 404.

**FR-CRS-022** — `Course.startAt` and `endAt` MUST remain per-course, defaulting
from the edition's window. Two courses in one edition may run on different
weeks.

**FR-CRS-023** — `Course.endAt` MUST be presentational. Nothing changes
automatically when it passes.

**FR-CRS-024** — An admin action MUST archive finished courses.

### Visibility

**FR-CRS-030** — Every non-archived course MUST be listed to any authenticated
user, regardless of enrollment.

**FR-CRS-031** — A non-enrolled user opening a course URL MUST see a teaser
page: discipline, course name, instructor, description. Nothing else.

**FR-CRS-032** — Course *contents* — exams, questions, calendar, resources,
roster — MUST be visible only to enrolled user and the course instructor.

**FR-CRS-033** — Instructor-only sub-routes (`/manage`, `/roster`,
`/gradebook`) MUST render 403 for anyone else.

**FR-CRS-034** — An archived course MUST disappear from listings, MUST render
404 for non-enrolled users, and MUST remain fully readable to people who were
enrolled, behind a clear archived banner.

**FR-CRS-035** — `/courses` MUST list the courses the viewer takes or teaches,
and MUST offer a separate section for finding a new course.

> This supersedes the "no catalog, 403 for other people's courses" rule in
> `dev/specs/to-do/courses.md`. `courseVisibility` becomes two predicates: *may
> see it exists* (any authenticated user, non-archived) and *may see its
> contents* (enrolled, instructor, system).

### Who sees what

| Actor                      | Listing | Teaser | See Contents     | Interact | Manage |
| :------------------------- | :------ | :----- | :--------------- | -------- | :----- |
| Instructor or admin, owner | all     | yes    | yes              | mocked   | yes    |
| Admin, other               | all     | yes    | yes              | no       | no     |
| Instructor, other          | all     | yes    | only if enrolled | no       | no     |
| Any user, enrolled         | all     | yes    | yes              | yes      | no     |
| Student, other             | all     | yes    | no               | no       | no     |
| Dropped student            | all     | yes    | no               | no       | no     |
| Anonymous                  | none    | no     | no               | no       | no     |

## Enrollment

**FR-CRS-040** — A student MUST be able to join a course in two ways: by
redeeming a classroom invite link, or by entering a live passphrase on the
course teaser page.

**FR-CRS-041** — A `Passphrase` MUST be course-scoped, unique, and expiring. The
join form MUST appear on the teaser page only while a live passphrase exists.

**FR-CRS-042** — Both the student and the instructor MUST be able to drop an
enrollment.

**FR-CRS-043** — A `DROPPED` enrollment MUST remove all access to course
contents for that student, including their own past submissions.

**FR-CRS-044** — A dropped student's submissions MUST remain visible to the
instructor in the gradebook.

**FR-CRS-045** — Enrolling after an exam has closed MUST NOT create responses
retroactively. The student has no submission and therefore scores zero.

### Joining by passphrase

> As a student with no invite link, I want to type the code my instructor wrote
> on the board, so I can join without email.

**Given** I am logged in and viewing a course I am not enrolled in
**And** the course has a passphrase that has not expired
**When** I enter the passphrase and submit
**Then** an `ACTIVE` enrollment is created
**And** the page reloads as the full course view

**Given** the passphrase has expired or the course is archived
**When** I open the course URL
**Then** I see the teaser with no join form, and no hint that a passphrase ever
existed

## Schema impact

- New model `Edition` (slug, name, `startAt`, `endAt`); `Course.edition`
  becomes a relation, and the unique key follows.
- `Course` gains `archivedAt DateTime?` (or an equivalent status).
- `Enrollment` exists as specified in `dev/specs/to-do/courses.md`.

## Open questions

- May an instructor enroll a student directly, by username or school id, or are
  invites and passphrases the only paths in?
- Can a student hold enrollments in two courses of the same discipline (a
  retake, or two sections)? Nothing currently prevents it.
