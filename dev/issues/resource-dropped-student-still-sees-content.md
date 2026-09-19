# A dropped student can still read a course's resources

`ResourceService.findOne`/`findMany` (`src/db/services/resource.service.ts`)
gate visibility with `canViewCourseContents(actor, course)`
(`src/auth/permissions.ts`), which checks `course.enrollments.some(e =>
e.username === actor.username)` with no status check.

`resourceInclude`'s `enrollments` select (`resource.service.ts:54`) loads
`{ username: true }` only — it never selects `status`, and never filters to
`ACTIVE`. So once a student is ever enrolled, `course.drop()` (which only
flips `Enrollment.status` to `DROPPED`, never deletes the row — see
`CourseService.drop`) has no effect on resource visibility: the row is still
present, so `canViewCourseContents` still matches.

Confirmed by direct probe against `db.resource.findMany`: an actively-dropped
student still gets the course's resources back, same length as an active
enrollee.

Contrast `courseVisibility`/`courseContentsVisibility`
(`src/auth/permissions.ts:307`), the Prisma-`where` sibling of
`canViewCourseContents`, which does filter `status: "ACTIVE"` — the two
predicates have drifted apart.

## Fix

Either:
- select `status` alongside `username` in `resourceInclude.course.enrollments`
  and have `canViewCourseContents` (or a resource-local wrapper) check it, or
- swap the in-memory `canViewCourseContents` check for the `courseVisibility`
  Prisma-`where` fragment resource.service.ts already imports
  (`courseContentsVisibility`) — it's already dead-code-adjacent in
  `findMany`, see the unreachable `course ? ... : { course:
  courseContentsVisibility(opts.actor) }` branch a few lines below.

Not fixed here: found while migrating `test/resource-service.spec.ts` off the
old flat resource shape; fixing it is a permissions-behavior change, not a
shape-migration one, so it's out of scope for that pass.
