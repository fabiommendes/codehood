---
type: note
status: active
tags: [feedback-release, exam-phase, quiz]
relatedTo: [exam-state, feedback-service]
---

# Grade release is decided in two places

`releasedToStudents` (`src/db/services/feedback.service.ts`) decides which
feedback a student may read. `resultsReleased` (`src/db/exam-state.ts`)
decides whether the exam page shows results. They agree except for a `QUIZ`:

- `releasedToStudents` ends the window with `examEndsAt`, which treats a null
  duration as 1 ms, so an untimed scheduled quiz releases right after it opens.
- `resultsReleased` waits for the quiz's phase to be `closed`, and an untimed
  `SCHEDULED` quiz stays `open` until it is `COMPLETED`.

Today the mismatch only delays what the page shows; it never exposes
unreleased feedback. Make `releasedToStudents` delegate to `resultsReleased`
(converting the ms columns), and settle what an untimed quiz means, before a
third caller appears.
