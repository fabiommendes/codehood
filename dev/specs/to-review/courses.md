# Basic display of courses

Roadmap 0.1.0, "Display courses and assignments.". This spec covers the
courses half. Assignments and exams need question rendering and a submission
flow, which is the other 0.1.0 item, so exams stay mocked here.

"Course" is a discipline taught by one instructor in one edition. 

## Scope

Real data:

- `CourseService`, plus a `DisciplineService`, following
  `docs/design/db-service-classes.md`.
- The actor plumbing in `src/db/base-service.ts`: `SYSTEM`, `FULL_ACCESS`,
  `Actor`, and the `*As` interfaces, plus moving `UserService`,
  `SessionService`, `ApiKeyService`, and `InviteService` onto them.
- An `Enrollment` table, because nothing currently links a student to a course.
- `/courses`, listing what you take and what you teach.
- `/<discipline>/<username>_<edition>`, the course home page: title, discipline,
  instructor, description, term dates, enrolled headcount.
- `/<discipline>/<username>_<edition>/manage` and `/roster` for instructors,
  reading the real roster.
- The classroom invite flow, which currently hardcodes `CS101_COURSE_ID = 101`
  against a Course table that has no rows.
- The course list in `AppLayout`'s sidebar, currently three hardcoded links.
- `manage create-course`, since courses have no other way in until the CLI sync
  lands in 0.2.0.

Still mocked, deliberately, and marked as such on screen:

- The schedule section on the course page. `TimeSlot` and `Event` exist in the
  schema but nothing writes them.
- Exams, the exam index, and the gradebook.
- Resources.

Out of scope: creating or editing a course through the web UI, dropping
students, TAs and co-instructors, and any discipline-level page. Course
management is done by the instructor via the CLI. Dropping students, TAs and
co-instructors, and discipline-level pages are all follow-up work. Put them in
the roadmap for 0.3.0.

## Design decisions

### Enrollment is its own table, and `Course.instructorId` stays

```prisma
enum EnrollmentStatus {
  ACTIVE
  DROPPED
}

model Enrollment {
  id     Int              @id @default(autoincrement())
  status EnrollmentStatus @default(ACTIVE)

  userId Int
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  courseId Int
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@unique([userId, courseId])
}
```

Keeping `Course.instructorId` rather than folding the instructor into a
membership table with a role column keeps this migration to one added model. The
cost is that TAs and co-instructors have nowhere to live yet. That is the right
trade while there is exactly one instructor per course and no TA anywhere in the
product.

`status` exists so dropping a student later is reversible and keeps the original
enrollment date. Nothing writes `DROPPED` in this spec.

### URLs follow `docs/design/url-structure.md`

A course is `/<discipline-slug>/<username>_<edition>`. That document is the
reference; the parts that constrain this implementation are:

- No new column. The URL is built from `disciplineSlug`, the instructor's
  `username`, and `edition`, which are already the unique key on `Course`.
- Discipline slugs share the root namespace with `/login`, `/design`, and the
  rest, and Astro silently prefers the static route, so `DisciplineService` has
  to reject reserved slugs at creation.
- `edition` matches `^[0-9]{4}(-[1-9][0-9]*)?$` and is validated in the service,
  not just at the form.
- `username` needs a real format rule for the first time. It is
  `z.string().min(1)` today in both `acceptInvite` and `profile.update`, which
  allows a slash in a path segment.

### URL building and parsing are pure functions in `src/utils/course-url.ts`

```ts
export interface CourseRef {
  disciplineSlug: string;
  username: string;
  edition: string;
}

export function courseHref(ref: CourseRef): string;
export function parseCourseSegment(segment: string): { username, edition } | null;
export const EDITION_RE: RegExp;
export const DISCIPLINE_SLUG_RE: RegExp;
export const RESERVED_SLUGS: ReadonlySet<string>;
```

No Prisma import, so the parsing and reserved-word rules get unit tests that run
without a database. Every link in the app goes through `courseHref` rather than
building the path inline, so the scheme changes in one place if it ever changes.

### Enrollment methods live on `CourseService`

`Enrollment` is a join table with no identity of its own, the same shape as
`GroupMembership`, which also has no service. So `enroll`, `unenroll`,
`isEnrolled`, and `listStudents` are `CourseService` methods rather than a third
service. `Discipline` does get its own service, because it is a real entity with
its own slug rules and it is created independently of any course.

`CourseService` uses the `@validate` decorator for its Zod schemas, the same as
`AuthService`, and implements the acting variants of the CRUD interfaces
described in the access-control section below.

```ts
type FindOneBy = FillUndefineds<{ id: number } | { ref: CourseRef }>;

interface FindManyBy {
  instructorId?: string;
  disciplineSlug?: string;
}
```

There is no "my courses" filter, because the actor already is one. `/courses`
calls `findMany({}, { actor: user })` and gets back what that user may see,
which is precisely the definition of their course list. The filter fields narrow
inside that scope rather than widening it, so an `AND` of the caller's filter and
the visibility fragment is the whole `where` clause. That is one query with one
`OR` over the enrollment relation and the instructor relation, not two queries
merged in JavaScript, so the listing page stays a single round trip.

The returned type includes `discipline`, `instructor`, and
`_count.enrollments`, because every view that shows a course shows its
discipline name, its instructor's name, and its headcount. Splitting those into
separate calls would mean three queries per card on the listing page.

### Redeeming a classroom invite enrolls the student

`Invite.courseId` has been on the table since the auth work and nothing reads
it. `authService.acceptInvite` now creates the `Enrollment` row inside the
transaction that creates the `User` and the `InviteRedemption`, when the invite
carries a `courseId`. Without this, `/courses` is empty for every student and
there is nothing to display.

This also fixes the invite page. `CS101_COURSE_ID = 101` becomes the real id of
the course whose URL the page was reached through.

### Access control lives in `CourseService`

The conventions are `docs/design/db-service-classes.md` and
`docs/design/service-access-control.md`. Course is the first service with real
rules, so the short version: every method that returns different results to
different people takes `opts.actor`, `opts` is required on those methods, and
forgetting the actor is a compile error rather than a data leak. Trusted callers
pass `FULL_ACCESS`. Callers never post-filter.

`CourseService` implements `FindOneAs`, `FindManyAs`, `CreateAs`, `UpdateAs`,
and `DeleteAs`. `DisciplineService` implements plain `FindMany`, because
disciplines are public, and `CreateAs`, because not everyone may add one.

#### Who sees which courses

| Actor        | `findMany` returns                                 | `findOne` on someone else's course | May manage              |
| :----------- | :------------------------------------------------- | :--------------------------------- | :---------------------- |
| `SYSTEM`     | every course                                       | the course                         | yes                     |
| `ADMIN`      | every course                                       | the course                         | yes                     |
| `INSTRUCTOR` | courses they teach +  courses they are enrolled in | throws `FORBIDDEN`                 | only courses they teach |
| `STUDENT`    | courses with an `ACTIVE` enrollment                | throws `FORBIDDEN`                 | never                   |

An instructor does not see other instructors' courses. There is no catalog or
course-discovery feature yet, and inventing visibility rules for one before it
exists means guessing at requirements. When a catalog arrives it can add an
explicit filter rather than widening the default.

An instructor enrolled as a student in another course sees it in their list.
The two relations are independent, and someone taking a colleague's course is a
real thing that happens.

`DROPPED` enrollments do not grant visibility. Nothing writes that status in
this spec, so a unit test covers the branch rather than the UI.

#### Filter or throw

`findMany` narrows its `where` and returns fewer rows. It never throws for
visibility.

`findOne` returns `null` for a course that does not exist, and throws
`FORBIDDEN` for one that exists but is not yours. `load-course.ts` maps those to
404 and 403, which is what lets the 403 page name the course the student was
trying to reach.

`create`, `update`, `delete`, `enroll`, and `unenroll` throw `FORBIDDEN`.
`create` additionally rejects an instructor naming somebody else as the course
instructor. An admin may create a course on any instructor's behalf, which is
how `manage create-course` behaves when an operator runs it.

`listStudents` is instructor and admin only. Students cannot list their
classmates. That is a privacy default rather than a technical limit, and it is
easy to relax later if the roster should be visible inside a course.

#### The rules are written twice, and a test pins them together

```ts
// src/auth/permissions.ts, adjacent
export function canViewCourse(actor: Actor, course: CourseWithInstructor): boolean;
export function canManageCourse(actor: Actor, course: CourseWithInstructor): boolean;
export function courseVisibility(actor: Actor): Prisma.CourseWhereInput;
```

`courseVisibility` is what `findMany` pushes into SQL. `canViewCourse` is what
`findOne` and the UI use. They encode one rule in two languages and will drift,
so a test seeds a fixture set covering every row of the table above, runs
`findMany` for each actor, and asserts the result equals the rows where
`canViewCourse` returns true.

Ownership compares `course.instructor.id` against `actor.id`. Not
`course.instructorId`, which is a username, since the relation targets
`User.username`.

#### Enrolling a user who has no session yet

`acceptInvite` creates the `User`, the `InviteRedemption`, and the `Enrollment`
in one transaction, before any session exists. That call passes `FULL_ACCESS`
inside the transaction, since there is no actor to speak for yet. It is the
clearest example of why the trusted actor is an explicit constant instead of an
omitted argument.

### Mocked sections are labelled on screen

The schedule, exams, and resources sections keep the markup and the sample
content they already have in the `cs101` mockups, under an `Alert` saying the
data is a preview. `/manage` and `/roster` already carry exactly this alert, so
this is the established pattern rather than a new one. The roster loses its
alert, since it now reads real enrollments.

Labelling matters more than usual here, because the page around the mock
sections is real. A student looking at their genuine course name above a
fictional midterm date should be able to tell which is which.

### The `cs101` mockup pages move rather than getting deleted

`src/pages/courses/cs101/*` becomes `src/pages/[discipline]/[course]/*`. Each
page keeps its mock body and gains a real header, read from the database by the
shared loader below. `/courses/index.astro` stays where it is and starts
querying. The `cs101` directory goes away entirely, so no page is left rendering
a course that does not exist.

Every one of those pages needs the same four steps: parse the segment, load the
course, check permission, 403 or 404 on failure. That goes in one helper,
`src/utils/load-course.ts`, alongside `requireUser`, which the profile work
already extracted for the same reason.

### Course creation: a management command plus seed data

`manage create-course <discipline-slug> <instructor> <edition>`, following
`docs/design/management-commands.md`, prompting for description and term dates,
and creating the `Discipline` if it does not exist yet. Documented in that file
in the same commit.

The seed also gains two demo courses with enrolled students, because the
Playwright specs need a course to open and because `/courses` renders nothing
useful on a fresh database otherwise.

When the CLI sync arrives in 0.2.0 it calls the same `CourseService.create`, so
the command is not throwaway work.

## Migration

One new model and one new enum, `Enrollment` and `EnrollmentStatus`, plus the
back-relations on `User` and `Course`. No column changes to existing tables, so
existing rows need no backfill. Validation rules on `username`, `edition`, and
`Discipline.slug` are service-layer and application-layer, not schema
constraints.

## Tests

Service specs, no browser:

- `parseCourseSegment` round-trips with `courseHref`, and rejects a segment with
  no underscore, a bad edition, and `2026-01`.
- `DisciplineService.create` rejects `login`, `design`, and `api`, and accepts
  `cs101`.
- `CourseService.create` rejects a malformed edition and a duplicate
  discipline/instructor/edition triple.
- Redeeming a classroom invite with a `courseId` creates the enrollment;
  redeeming a personal invite without one does not.

Access control, over one fixture set covering every row of the visibility table:

- `findMany` for each actor returns exactly the courses where `canViewCourse`
  returns true. This is the test that keeps the Prisma fragment and the
  predicate from drifting, so it asserts set equality, not a row count.
- A student sees their `ACTIVE` enrollments and not a `DROPPED` one.
- An instructor sees courses they teach plus courses they are enrolled in, and
  no others.
- An admin sees every course; `SYSTEM` sees every course.
- `findOne` returns `null` for a course that does not exist and throws
  `FORBIDDEN` for one that exists but belongs to someone else. Both cases, since
  conflating them is the mistake this design exists to prevent.
- `update`, `delete`, and `enroll` throw `FORBIDDEN` for a student and for an
  instructor who does not teach the course.
- `create` rejects an instructor naming a different instructor, and allows an
  admin to do it.
- `listStudents` throws for an enrolled student.

Playwright, against the seeded database:

- A student logs in, sees exactly their courses on `/courses`, opens one, and
  the heading matches the seeded course name.
- That student gets a 403, naming the course, on a course they are not enrolled
  in, and a 404 on `/cs101/nobody_2026-1`.
- An instructor sees `/manage` and `/roster`, and the roster row count matches
  the seeded enrollment count.
- A student following the instructor's `/manage` URL gets a 403.

Screenshots of `/courses`, a course page, and the roster go to the human before
this is called done.

## Follow-up, not in this spec

- Narrowing what a grading bot can read. The API-key middleware makes a bot act
  as the instructor who issued its key, so a bot currently sees every course that
  instructor sees. Worth fixing before a bot reads real student data.
- `/<discipline-slug>` as a page listing every edition of a discipline.
- Real schedule data, which needs `TimeSlot` and `Event` writers and probably
  the CLI sync.
