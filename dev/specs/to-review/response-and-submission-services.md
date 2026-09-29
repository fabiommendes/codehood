---
type: spec
status: to-review
tags: [service, response, submission, rest-api, ttdd]
relatedTo: [questions, courses, student-exam-list, permissions-unification]
---

# Response and Submission services

## Goal

Two service classes over the `Response` and `Submission` Prisma models, plus
their REST surface, so a student client can answer an exam and an instructor
can read and grade what came back. Grading itself (the `Feedback` model) is a
later cycle.

## Domain

- A **Response** is one student's attempt at one exam. It decides whether more
  answers may arrive.
- A **Submission** is one attempt at one question inside that response. A
  response is a collection of submissions, one or more per question; attempts
  accumulate rather than overwrite, so a response keeps its full history.
- A graded exam (`QUIZ`, `EXAM`, `FINAL`) is answered once: one response per
  student per exam. A `PRACTICE` exam may be attempted as often as the student
  likes, each attempt a separate response.
- Repeat practice attempts are told apart by `slotKey`: `0` for a graded exam,
  the session's start as a unix timestamp in seconds for a practice one. The
  service converts it to `practiceSession: Date | null` on the way out — `0`
  surfaces as `null`.

## Schema (done)

`Response` now reads:

```prisma
model Response {
  id       Int    @id @default(autoincrement())
  publicId String @unique
  acceptingSubmissions Boolean @default(true)
  authorId String
  examId   Int
  slotKey  Int @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  submissions Submission[]
  @@unique([authorId, examId, slotKey])
  @@map("ResponseRef")
}
```

| Change                                             | Why                                                                                                                                                           |
| :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `questionId` removed                               | A response answers an exam, not a question. The question lives on `Submission`, which already carries it.                                                     |
| `examId` now required                              | An artifact of older modelling; every response belongs to an exam.                                                                                            |
| `practiceSession` replaced by `slotKey Int`        | A nullable date cannot be constrained: SQLite treats a null in a unique tuple as distinct from every other null, so the index would silently pass duplicates. |
| `@@unique([authorId, examId, slotKey])`            | No column in the tuple is ever null, so this is enforced in every case.                                                                                       |
| `publicId String @unique` on both models           | Public URLs never expose the autoincrement id.                                                                                                                |
| `Feedback.submissionId` added, `onDelete: Cascade` | The model had no link to what it grades.                                                                                                                      |
| `FINAL` added to `ExamType`                        | Pre-existing drift: `examType` listed it, the Prisma enum did not, and `typecheck` was red at `HEAD` because of it.                                           |

`ResponseId`/`SubmissionId`/`FeedbackId` brands and the `publicId` primitive are
in `src/core/schemas/base.ts`; `PRACTICE_SESSION_WINDOW_MS = 12h` is in
`src/core/constants.ts`. No migration to write — the project uses `db push`.

## Public API

Schemas in `src/core/schemas/response.ts` and `src/core/schemas/submission.ts`.
Services in `src/db/services/response.service.ts` and
`src/db/services/submission.service.ts`, both registered on `db`.

### ResponseService

Full CRUD plus `upsert`, keyed on `id` or `publicId`, with one extra method:

```ts
submit(input: ResponseSubmit, opts: ServiceOpts): Promise<Response>
```

`submit` takes a course, an exam slug and a question slug. It resolves the
attempt (creating it when absent) and appends one submission for that question,
in one transaction. It is the only call a student client needs.

`Response` embeds `submissions` — the attempt is rarely useful without the
answers in it, and embedding removes an N+1 from every exam render. `courseId`,
`examSlug` and `practiceSession` are derived output fields, not columns.

### SubmissionService

CRUD minus `upsert` (`upsert: never` — an attempt is never revised in place).
`create` takes `response` plus a `question` slug. `update` moves `status` and
nothing else: the payload is the record of what the student sent.

### REST

| Method                 | Path                             | Service call                 |
| :--------------------- | :------------------------------- | :--------------------------- |
| `POST`/`GET`/`PUT`     | `/api/course/{d}/{c}/response`   | `create`/`findMany`/`upsert` |
| `GET`/`PATCH`/`DELETE` | `.../response/{publicId}`        | `findOne`/`update`/`delete`  |
| `POST`/`GET`           | `/api/course/{d}/{c}/submission` | `create`/`findMany`          |
| `GET`/`PATCH`/`DELETE` | `.../submission/{publicId}`      | `findOne`/`update`/`delete`  |
| `POST`                 | `/api/course/{d}/{c}/submit`     | `submit`                     |

Both resources are course-scoped and addressed by `publicId`, never by `id`.

## Access control

Permission entities `response` and `submission` in
`src/auth/permissions/index.ts`, against a `ResponseWithCourse` target. No admin
branch on any of them, matching `course.update-contents`.

| Permission                                                                     | Holder                                                                        |
| :----------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| `response.create`, `response.submit`, `submission.create`                      | the author, when enrolled and writing their own work; the course's instructor |
| `response.read`, `submission.read`                                             | the author; the course's instructor                                           |
| `response.update`, `response.delete`, `submission.update`, `submission.delete` | the course's instructor                                                       |

## Business rules

| Id   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :--- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1   | `slotKey` is `0` for a `QUIZ`, `EXAM` or `FINAL`, and a unix timestamp in seconds for a `PRACTICE` exam. A caller naming a `practiceSession` on a graded exam is refused.                                                                                                                                                                                                                                                                   |
| R2   | A submission's question must be one the response's exam carries.                                                                                                                                                                                                                                                                                                                                                                            |
| R3   | The author must hold an `ACTIVE` enrollment in the exam's course.                                                                                                                                                                                                                                                                                                                                                                           |
| R4   | A submission is refused when its response has `acceptingSubmissions: false`.                                                                                                                                                                                                                                                                                                                                                                |
| R5   | A submission is refused unless the exam's phase is open, see `src/db/exam-state.ts`.                                                                                                                                                                                                                                                                                                                                                                                       |
| R6   | A submission's `responseId` and `questionId` are resolved by the service, never taken from the caller as a pair that could disagree.                                                                                                                                                                                                                                                                                                        |
| R7   | `submit` against a practice exam reuses the student's newest attempt when its `practiceSession` is within `PRACTICE_SESSION_WINDOW_MS` of now, otherwise opens a new one. Against a graded exam it always resolves the single `slotKey = 0` attempt.                                                                                                                                                                                        |
| R8   | A response or submission the actor may not read is `NotFound`, not `NotAllowed`, so an id is not a probe for whether another student answered. This covers a write that merely *references* a row by id, not only a read: naming another student's response when creating a submission is `NotFound`, indistinguishable from naming one that never existed. `NotAllowed` is reserved for a row the actor can already see but may not write. |
| R9   | `findMany` narrows a student to their own rows in the database query; an `author` filter naming somebody else is `NotAllowed`, not quietly emptied.                                                                                                                                                                                                                                                                                         |
| R10  | A response carries many submissions for the same question — answering twice appends, it does not replace.                                                                                                                                                                                                                                                                                                                                   |

## Acceptance criteria

1. A student answers two different questions of one ongoing exam and ends with
   one response holding two submissions; answering the first again makes three.
2. Two `submit` calls against a practice exam 13 hours apart produce two
   responses; two calls an hour apart produce one. The same two calls against a
   graded exam always produce one.
3. A student cannot read, list, update or delete another student's response or
   submission, by `publicId` or through a filter, and gets `NotFound` rather
   than `NotAllowed` on the direct reads and on a write that references one.
4. The instructor of the course sees every student's work; an instructor of
   another course, and a non-owning admin, see none of it.
5. A submission against a `SCHEDULED`, `COMPLETED` or `DRAFT` exam is refused,
   as is one against a closed response or a question the exam does not carry.
6. `pnpm run lint` exits 0 and `/openapi.json` carries all thirteen new routes.

## Testing strategy

- `test/response-service.spec.ts` and `test/submission-service.spec.ts`,
  Playwright, following `test/question-service.spec.ts` and
  `test/exam-link.spec.ts` for setup shape.
- Fixtures `src/fixtures/response.factory.ts` and
  `src/fixtures/submission.factory.ts`, mirroring `exam.factory.ts`.
- Happy path: one scenario per service asserting as much as it can at once.
- Edge cases: one focused test per rule above, R1 through R10.
- The practice window (R7) is a pure boundary over a timestamp — table-driven,
  with the clock injected rather than slept on.
- Access control gets a matrix over {author, peer student, owning instructor,
  other instructor, admin, SYSTEM} x {read, list, update, delete}, asserting
  the exact error class, not merely that it threw.
- Bruno examples under `test/bruno/` for the seven endpoints.

## Out of scope

- The `Feedback` service. The column exists now; the service is the next cycle.
- Validating a submission payload against its question's type. The payload is
  stored as sent; `src/mdq/scoring.ts` has the types but no Zod schemas for
  answers, so the check belongs with grading.
