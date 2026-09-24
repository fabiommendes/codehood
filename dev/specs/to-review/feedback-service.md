---
type: spec
status: to-review
tags: [service, feedback, grading, rest-api, ttdd]
relatedTo: [response-and-submission-services, questions, courses, permissions-unification]
---

# Feedback service

## Goal

A service class over the `Feedback` Prisma model plus its REST surface, so an
instructor or a grading bot can record a score and a comment against one
submission, and a student can read the ones released to them. This is the cycle
`response-and-submission-services.md` deferred.

## Domain

- A **Feedback** is one grading pass over one submission: a score, an optional
  comment, and who produced it.
- A submission collects more than one: a bot grades it, the instructor revises.
  Each carries a `ref` its writer chose, unique within the submission; the
  newest is the current verdict. `(submissionId, ref)` is the natural key the
  schema's header calls for, so there is no `publicId`.
- A grader is either a **user** (`graderId`) or a **bot** (`botId`), never both
  and never neither.
- **Release** decides when the student sees a score, and each exam type
  releases differently: a `PRACTICE` exam the moment the score is written, a
  `QUIZ` once its time window closes, an `EXAM` only when the instructor says
  so. Release is a property of the exam, computed once per row and never
  authored on the feedback itself.

## Schema

`Feedback` gains one column and one index, and `Exam` gains the release
timestamp it never had; everything else already exists.

```prisma
model Feedback {
  id  Int    @id @default(autoincrement())
  ref String              // NEW

  submissionId Int
  submission   Submission @relation(..., onDelete: Cascade)

  score    String
  graderId String?
  botId    String?
  feedback String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([submissionId, ref])   // NEW
}
```

| Change | Why |
| :----- | :-- |
| `ref String` | Supplied by the writer and opaque to the server, the public half of the natural key. The schema header reserves `publicId` for models with no natural key; this one has one. |
| `@@unique([submissionId, ref])` | Neither column is nullable, so the constraint holds in every case. |
| `Exam.gradesReleasedAt DateTime?` | An `EXAM`'s grades reach its students when the instructor releases them, which the `ExamType` comment has always described and no column recorded. Null means unreleased. |

```prisma
model Exam {
  ...
  /// When the instructor released this exam's grades to its students. Null
  /// until they do. Only consulted for an `EXAM`; a `PRACTICE` releases on
  /// write and a `QUIZ` when its window closes.
  gradesReleasedAt DateTime?   // NEW
}
```

`FeedbackId` is already branded in `src/db/branding.ts` and
`src/core/schemas/base.ts`. No migration to write — the project uses `db push`.

## Public API

Schema in `src/core/schemas/feedback.ts`, service in
`src/db/services/feedback.service.ts`, registered on `db` as `db.feedback`.

```ts
/// A decimal or an `n/d` fraction, either one signed: `0.5`, `-0.25`, `1/3`, `-2/3`.
export const score = z.string().regex(/^-?(\d+(\.\d+)?|\d+\/\d+)$/).refine(inUnitRange);

export const feedbackSchema = z.object({
  id: feedbackId,
  ref: slug,                          // a URL segment, so a slug
  submissionId: submissionId,
  score: score,
  graderId: username.nullable(),
  botId: z.string().nullable(),
  feedback: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const feedbackCreate = feedbackSchema
  .omit({ id: true, submissionId: true, createdAt: true, updatedAt: true })
  .extend({
    submission: submissionRef,        // { id } | { publicId }
    graderId: username.nullish(),     // defaults to the actor
    botId: z.string().nullish(),
    feedback: z.string().nullish(),
  });

/// There is no separate upsert schema: PUT carries the same body as POST.

/// Re-grading appends another pass. Only the verdict itself moves on an existing row.
export const feedbackUpdate = feedbackSchema.pick({ score: true, feedback: true }).partial();

export const feedbackPK = z.union([
  z.object({ id: feedbackId }),
  z.object({ submission: submissionRef, ref: slug }),
]);

export const feedbackFilterBase = z.object({
  submission: submissionRef.optional(),
  exam: slug.optional(),
  question: slug.optional(),
  author: username.optional(),   // the student whose work was graded
  grader: username.optional(),
  bot: z.string().optional(),
  automated: z.boolean().optional(),  // true keeps bot feedback only
});
export const feedbackFilter = courseNaturalKey | { courseId } extension of the base;
```

`FeedbackService extends CrudBase<{ ... }>`: the full CRUD set. Both `create`
and `upsert` are keyed on `(submission, ref)`, the natural key, never on `id`;
`create` refuses a ref the submission already carries, `upsert` revises it. The
score is kept as the exact string the caller sent, never parsed into a float
and re-serialized.

### REST

| Method | Path | Service call |
| :----- | :--- | :----------- |
| `POST`/`GET`/`PUT` | `/api/course/{d}/{c}/submission/{publicId}/feedback` | `create`/`findMany`/`upsert` |
| `GET`/`PATCH`/`DELETE` | `.../submission/{publicId}/feedback/{ref}` | `findOne`/`update`/`delete` |

Nested under the submission, since a ref only identifies a feedback once the
submission is known. The last segment is the ref itself, never the
autoincrement id.

`PUT` addresses the collection rather than a ref segment, matching how the
`CRUD` helper places every other upsert, so the pass being written names its
`ref` in the body, exactly as `POST` does. Bruno examples under
`test/bruno/feedback/`.

## Access control

New permission entity `feedback` in `src/auth/permissions/index.ts`. The write
permissions take the existing `ResponseWithCourse` target; `feedback.read`
takes a `FeedbackTarget = ResponseWithCourse & { released: boolean }`, since
release is the whole of the student's read rule.

| Permission | Holder |
| :--------- | :----- |
| `feedback.create`, `feedback.update`, `feedback.delete` | the course's instructor (and SYSTEM). No student branch, no admin branch. |
| `feedback.read` | the course's instructor; the graded submission's author, once released (F4) |

## Business rules

| Id | Rule |
| :-- | :--- |
| F1 | Exactly one of `graderId` and `botId` is set. Both, or neither, is `InvalidData`. |
| F2 | `graderId` defaults to a user actor's own username. Naming a different grader is refused for anyone but SYSTEM. SYSTEM with no `botId` and no `graderId` is `InvalidData` (F1). |
| F3 | `score` is a decimal or an `n/d` fraction, either form signed, in `[-1, 1]`: `0.5`, `-0.25`, `1/3`, `-2/3`. Stored and returned as the exact string sent. Anything outside the range, or not in one of those two forms, is `InvalidData`. A zero denominator is `InvalidData`, not a division by zero. |
| F4 | Release, by exam type: `PRACTICE` the moment the score is written; `QUIZ` once its window has closed, i.e. `scheduledAt + durationMs + extraTimeMs` is in the past, or its status is `COMPLETED` when it carries no `scheduledAt`; `EXAM` only when `gradesReleasedAt` is non-null and in the past. An unreleased feedback does not exist as far as its author is concerned. |
| F4b | The window arithmetic is the one already in `src/db/util.exam-link.ts`, extracted there as `examEndsAt(exam)` and called from both places rather than repeated. The clock is injected, never read from `Date.now()` inside the rule. |
| F5 | Feedback the actor may not read is `NotFound`, not `NotAllowed` — including a write that merely references it, and including an unreleased row read by its own author. `NotAllowed` is reserved for a row the actor can see but may not write. |
| F6 | `findMany` narrows a student to released feedback on their own submissions, in the database query. An `author` filter naming somebody else is `NotAllowed`, not quietly emptied. |
| F7 | `create` against a submission the actor may not read is `NotFound`; against one they can read but not grade, `NotAllowed`. |
| F8 | Feedback accumulates: grading the same submission twice under two refs yields two passes, and two concurrent graders writing different refs never collide. `submissionId` is resolved from `submission`, never taken as a second field that could disagree. |
| F9 | Deleting a submission deletes its feedback (`onDelete: Cascade`); deleting feedback leaves the submission standing. |
| F10 | A ref is unique within its submission and chosen by the writer: `create` under a ref already there is `InvalidData`, `upsert` revises it, deleting a pass frees its ref to be written again, and the same ref under another submission is a separate pass. |

## Acceptance criteria

1. An instructor grades a submission and the row comes back under the ref they
   sent, with `graderId` set to them, `botId` null, the score string
   byte-identical to what was sent, and visible to them and (per F4) to the
   student.
2. SYSTEM grades the same submission under another ref with a `botId`;
   `GET .../feedback` returns both, oldest first.
3. The author sees the feedback exactly where F4 says and gets `null` and an
   empty list everywhere else: on a `PRACTICE` at once; on a `QUIZ` not before
   its window closes and immediately after; on an `EXAM` not until
   `gradesReleasedAt` is set, and at once when it is. The instructor sees it in
   every one of those cells.
4. A peer student, an instructor of another course and a non-owning admin can
   neither read, list, create, update nor delete it, with the exact error class
   F5 prescribes.
5. Every score outside `[-1, 1]` or outside the accepted forms is refused, and
   no row is written.
6. `GET .../feedback/{ref}` resolves the same row `GET .../feedback` lists
   under that ref, and no route anywhere accepts or emits the autoincrement id.
7. `pnpm run lint` exits 0 and `/openapi.json` carries the six new routes.

## Testing strategy

- `test/feedback-service.spec.ts`, Playwright, following
  `test/submission-service.spec.ts` for setup shape.
- Fixture `src/fixtures/feedback.factory.ts`, mirroring `submission.factory.ts`
  and provisioning its own submission when `submission` is left unset.
- Happy path: one scenario covering create by instructor, create by bot,
  accumulation, findOne by `(submission, ref)`, findMany, upsert, update and
  delete.
- F10 is a sequence over one submission — create three, delete the middle,
  write its ref again, assert the surviving refs.
- F3 is a pure predicate over a string — table-driven, valid and invalid
  columns in one list, asserting the stored string is unchanged for the valid
  ones.
- F4 is a matrix, driven from a `{type, status, scheduledAt, gradesReleasedAt,
  now, releasedToAuthor}` table, with `now` supplied rather than slept on. It
  covers both sides of the `QUIZ` boundary and an unscheduled `QUIZ`.
- F1/F2 get one focused test each; F5 asserts the error class, not merely that
  it threw.
- Access control: `{author, peer, owning instructor, other instructor, admin,
  SYSTEM} x {read, list, create, update, delete}`.

## Out of scope

- Computing a score from a submission payload. `src/mdq/scoring.ts` is a later
  cycle; this service records whatever score it is handed.
- An aggregate gradebook view over feedbacks.
- The endpoint and UI an instructor uses to set `gradesReleasedAt`. This cycle
  adds the column and reads it; writing it belongs with the exam's own
  management surface.
- Removing `FINAL` from `ExamType`. The value is unused and going away, so
  nothing here branches on it, but ripping it out of the enum, the Zod schemas,
  the fixtures and the tests is its own cycle.
