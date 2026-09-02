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

**FR-QST-006** — A question MUST belong to exactly one course. Its identity is
`(course, slug)`; the course's instructor owns it, and no separate owner column
exists because none can disagree with the course.

**FR-QST-007** — Copying a question into another edition MUST produce a distinct
question. Editing next year's copy cannot reach last year's rows, and last
year's responses keep the question they were answered against, intact.

## Versions

**FR-QST-010** — Editing a question's content MUST create a new version of a
Question and keep old versions that might be used by other resources in the
database.

**FR-QST-011** — each question as an opaque label supplied by the CLI. The
server MUST not infer the hash and MUST keep the version history as provided by
the CLI.

**FR-QST-012** — `(refId, versionHash)` MUST remain unique, so a buggy client
cannot map one hash to two contents.

**FR-QST-013** — A question in a exam MUST be pinned to a specific version when
a exam starts. If not pinned, force the latest version at the time of the exam's
start.

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

| The server needs                                       | Why                                               |
| :----------------------------------------------------- | :------------------------------------------------ |
| Construct a question from a plain object               | Validation at write time, rendering, grading      |
| Grade a submission payload against the merged question | FR-GRD-001                                        |
| Decide whether two versions are grade-neutral          | FR-SYNC-031                                       |
| SolidJS components for rendering and input validation  | Questions render client-side from `publicPayload` |

**FR-QST-040** — Question rendering and input validation MUST happen
client-side, from `publicPayload` only.

**FR-QST-041** — Scoring MUST happen server-side in every mode, including
practice, because `privatePayload` never reaches the browser.

**FR-QST-042** — Submitted answers MUST reference options by stable id, never by
position, since choice order is shuffled per student (FR-EXAM-031).

## Schema impact

- `QuestionData.payload` splits into `publicPayload` and `privatePayload`.
- `QuestionRef.disciplineSlug` → `courseId`; the unique key becomes
  `[slug, courseId]`. `authorId` is dropped: the course names the owner.
- `QuestionForCourse` is dropped. A question is already in exactly one course.
- `QuestionsForExam` gains `weight Float?` (default 1) and `voidedAt DateTime?`.
- `QuestionRef.publicId` is not unique today and needs the constraint, since it
  is the token that addresses a question outside the CLI's natural key.

## Open questions

- **Cross-edition statistics have nothing to correlate on.** `Group` exists so
  co-teaching instructors can compare how a question performs, but per-course
  identity means this year's copy and last year's are unrelated rows. Solving it
  later means a lineage token the CLI carries when it copies a file — deliberately
  not V1, and noted here so the feature is not designed as if the link exists.
- Does a question need an `authors` field at all, or does authorship live in the
  content the CLI pushes and never become a server-side concept?
