# Questions

The server stores questions and serves them. It has no opinion about what a
question *means* — types, validation, rendering, and grading all belong to
`mdq-js`.

## Storage

**FR-QST-001** — A question MUST separate its stable identity (`QuestionRef`)
from its content (`QuestionData`), so editing appends a version rather than
overwriting one.

**FR-QST-002** — Question content MUST be stored in two columns:
`publicPayload` and `privatePayload`.

**FR-QST-003** — `publicPayload` MUST contain everything a student may see.
`privatePayload` MUST contain everything they may not — answer keys, grading
configuration, solution notes.

**FR-QST-004** — Student-facing responses MUST serialize `publicPayload` alone.
The server MUST NOT filter, redact, or strip a merged object on the way out.

> Splitting at rest rather than filtering on egress is the whole point. A
> forgotten strip leaks every answer for every future edition of the course;
> with two columns there is nothing to forget, because the private half is never
> loaded on the rendering path.

**FR-QST-005** — Validation and grading MUST merge the two payloads and hand the
result to the `mdq-js` constructor, which builds a question from a plain object.

**FR-QST-006** — A question MUST have exactly one owner (`ownerId`), the
instructor of the course it belongs to.

**FR-QST-007** — `QuestionType` MUST remain a server-side enum. `mdq-js` is the
upstream authority on which types exist; the server MAY implement a subset and
MUST refuse the rest (FR-SYNC-041).

## Versions

**FR-QST-010** — Editing a question's content MUST create a new `QuestionData`
row and repoint `QuestionRef.latest`. Existing rows MUST NOT be mutated.

**FR-QST-011** — `versionHash` MUST be treated as an opaque label supplied by
the CLI. The server MUST NOT infer that content changed from a changed hash, nor
that it is unchanged from an equal one.

**FR-QST-012** — `(refId, versionHash)` MUST remain unique, so a buggy client
cannot map one hash to two contents.

**FR-QST-013** — A question MAY be pinned to a specific version by an exam
(`QuestionsForExam.version`) or a course (`QuestionForCourse.version`).

**FR-QST-014** — An unset pin MUST mean "use `QuestionRef.latest`", and MUST NOT
be settable by a user. The server sets it at `SCHEDULED` (FR-EXAM-013).

## Status

**FR-QST-020** — `QuestionStatus` MUST be a property of the pushed content, not
a control in the web app. There is no publish button.

**FR-QST-021** — `ARCHIVED` MUST mean "offered in nothing new". Archived
questions MUST continue to render inside exams that already reference them, and
students MUST retain access to their own answers.

## Weights

**FR-QST-030** — A question's weight within an exam MUST live on
`QuestionsForExam`, and MUST default to 1.

**FR-QST-031** — An exam score MUST be `Σ(weight × score) / Σ(weight)` over the
questions that count. Weights are absolute, not normalized to a total.

**FR-QST-032** — Weights MUST NOT be changed while an exam is `ONGOING`
(FR-SYNC-032).

## The `mdq-js` boundary

The server depends on `mdq-js` for four things. Its API is not yet designed;
these are the requirements the server places on it.

| The server needs | Why |
| :--- | :--- |
| Construct a question from a plain object | Validation at write time, rendering, grading |
| Grade a submission payload against the merged question | FR-GRD-001 |
| Decide whether two versions are grade-neutral | FR-SYNC-031 |
| SolidJS components for rendering and input validation | Questions render client-side from `publicPayload` |

**FR-QST-040** — Question rendering and input validation MUST happen
client-side, from `publicPayload` only.

**FR-QST-041** — Scoring MUST happen server-side in every mode, including
practice, because `privatePayload` never reaches the browser.

**FR-QST-042** — Submitted answers MUST reference options by stable id, never by
position, since choice order is shuffled per student (FR-EXAM-031).

## Schema impact

- `QuestionData.payload` splits into `publicPayload` and `privatePayload`.
- `QuestionRef.authorId` → `ownerId`.
- `QuestionsForExam` gains `weight Float?` (default 1) and `voidedAt DateTime?`.
- `QuestionRef.publicId` is not unique today; if it stays, it needs a
  constraint — or it should be dropped, since identity is the natural key.

## Open questions

**Is the question bank scoped to a discipline or to a course?** This is
unresolved and load-bearing:

- `QuestionRef` hangs off `Discipline`, with `QuestionForCourse` as a join —
  a discipline-wide bank shared across editions and instructors.
- The natural key used by the CLI is
  `discipline/instructor_edition/question-slug`, which addresses a question
  *under a course*.

If the bank is discipline-wide, two instructors teaching the same discipline
share question identities and the last push wins — which contradicts "one
repository owns the content" unless they share a repository. If it is
per-course, reusing a question next year means a distinct row, and
`QuestionForCourse` is redundant.

The two readings differ in what happens when an instructor edits a question in
2027 that 2026's students already answered: shared identity rewrites their
question's lineage, per-course identity leaves it untouched.

Secondary: does `QuestionForCourse` survive at all, and if so, does it mean
"available for practice in this course" as distinct from "used in this exam"?
