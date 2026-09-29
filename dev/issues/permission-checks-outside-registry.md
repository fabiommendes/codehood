---
type: note
status: active
tags: [permissions, auth]
relatedTo: [permissions-registry, question-service]
---

# Permission checks that bypass hasPerm

The registry in `src/auth/permissions/index.ts` defines these entries, but the
services re-derive the rules instead of calling them, so their `audit` hooks
never run and the rules can drift:

- `question.read` / `question.read-public`: `QuestionService` checks
  `course.update-contents` / `course.read-contents` directly.
- `response.*` / `submission.*`: both services use their own
  `isCourseOwner`/`hasReadAccess`.
- `feedback.update` / `feedback.delete`: `FeedbackService` checks
  `isCourseOwner`.

`QuestionService.canViewQuestion` is a public parallel predicate with no
callers. It ignores enrollment status (a DROPPED student gets `true`) and
question status (DRAFT counts as public). Delete it, and the stale
`canReadQuestion`/`canWriteCourseContent` references in the module docs.

`UserService.updatePassword` (no current password needed) is allowed under
`user.update`, which includes the user themself; its doc says SYSTEM/admin
only.
