---
type: note
status: active
tags: [ux, grading, mobile, exams]
relatedTo: [ux-principles, web-grading, grades-table, navigation]
---

# Open UX findings

Found by walking every page as a student, an instructor and an admin, at
1200 px and 390 px. Principles P1 to P9 are in `docs/ux/principles.md`.

## Grading

- A choice question repeats its statement and options in every answer, below
  the answer key that already shows them.
- `withServiceErrors` in `src/actions/helpers.ts` turns `NotFound` into
  `BAD_REQUEST`, for every action.
- "Submitted" on the attempt page is the response's `updatedAt`; attempts
  store no submit time.
- The grades table shows "Pending" for a closed attempt at an exam with no
  questions.
- The grades table heads a column nobody attempted with "no average · 0 of 4"
  and fills it with "Missed" (P2: the column holds nothing to act on).
- `db.enrollment.findMany` filters one status per call, so `loadStudents`
  makes two queries.

## Exams

- A closed exam that nobody attempted offers "Release results" as its primary
  action (P2). `gradeReleaseBlocker` allows it on purpose; the question is
  whether the button should still be the page's primary action.
- An exam with no schedule reads "Scheduled: Not scheduled" and can be
  "Closed" at the same time (P3). Nothing on the page says what closed it.
- The student's page for a submitted exam shows a bare "Submitted" with no
  time, and its questions carry no heading that says they are the student's
  own answers.

## Navigation

- The Students tab lives at `/roster` (P4). Renaming the URL breaks links
  already shared.
- "Set up the CLI" is in every user's menu and `/getting-started` tells
  students to scaffold a course (P2).
- The footer shows a "Design system" link in development only; check that a
  production build hides it.
