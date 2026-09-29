---
type: note
status: active
tags: [docs, changelog, tests]
relatedTo: [changelog, requirements]
---

# Docs that no longer match the code

- `CHANGELOG.md` (user FK entry) says GroupMembership, Session,
  InviteRedemption and Enrollment use `userId`; commit e21d15f moved them back
  to `username`.
- `dev/requirements/07-calendar.md` FR-CAL-011/013/015 still describe the exam
  link, ten event kinds and authored event dates; the model has none of them.
- Time slots take `duration: {hours, minutes}` beside `start: {hour, minute}`;
  no changelog entry records the switch from `durationMin`.
- `src/urls/README.md` still gives `calendar-event` a flat address and leaves
  `exam` and `question` out of the action namespaces.
- `test/api-crud.spec.ts` compares `body.id` with `course.id`, both
  `undefined`; `test/openapi.spec.ts` removes `course`/`discipline` from the
  list before asserting they are absent. Neither test can fail.
