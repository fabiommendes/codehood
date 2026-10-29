---
type: issue
status: backlog
tags: [permissions, auth]
relatedTo: [permissions-registry, question-service]
---

# Permission checks that bypass hasPerm

The registry in `src/auth/permissions/index.ts` defines these entries, but the
services re-derive the rules instead of calling them, so their `audit` hooks
never run and the rules can drift:

- `question.read` / `question.read-public`: `QuestionService` checks
  `course.update-contents` / `course.read-contents` directly.
- `response.*` / `submission.*`: create and submit go through `ensurePerm`,
  but reads, updates and deletes still use the services' own
  `isCourseOwner`/`hasReadAccess`.
- `feedback.update` / `feedback.delete`: `FeedbackService` checks
  `isCourseOwner`.

`UserService.updatePassword` (no current password needed) is allowed under
`user.update`, which includes the user themself; its doc says SYSTEM/admin
only.
