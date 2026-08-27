# Exams

## Authoring and ownership

**FR-EXAM-001** — The exam paper — title, preamble, question list, weights — and
its schedule (`scheduledAt`, `durationMs`) MUST be authored in the repository
and pushed by the CLI.

**FR-EXAM-002** — Lifecycle transitions, extra time, and result release MUST be
server-side operations. They MUST NOT be settable from the repository.

## Lifecycle

```
DRAFT ──push──▶ SCHEDULED ──clock/start now──▶ ONGOING ──clock──▶ CLOSED ──instructor──▶ COMPLETED
                                                                                    ARCHIVED
```

| Status | Submissions | Students see | Set by |
| :--- | :--- | :--- | :--- |
| `DRAFT` | no | nothing | push |
| `SCHEDULED` | no | that it exists, and when | push |
| `ONGOING` | yes | the paper | clock, or "start now" |
| `CLOSED` | no | their own submissions | clock |
| `COMPLETED` | no | answers, feedback, scores | instructor |
| `ARCHIVED` | no | nothing new | push |

**FR-EXAM-010** — `SCHEDULED → ONGOING` and `ONGOING → CLOSED` MUST be driven by
the clock and evaluated **lazily**: the first request that touches the exam
after the boundary performs the transition inside a transaction.

> No scheduler, no cron, no background worker. The transition happens exactly
> once because the transaction guards it, and the cost falls on one request.

**FR-EXAM-011** — An instructor action "start now" MUST perform the
`SCHEDULED → ONGOING` transition immediately, overriding `scheduledAt`.

**FR-EXAM-012** — `CLOSED → COMPLETED` MUST require an explicit instructor
action. It MUST NOT happen on a timer.

**FR-EXAM-013** — Entering `ONGOING` MUST stamp every question's current version
onto `QuestionsForExam`, in the same transaction as the transition.

**FR-EXAM-014** — A closed exam MUST NOT be reopened. Reopening one student's
response (`Response.acceptingSubmissions`) is the only per-person exception.

## The window

**FR-EXAM-020** — The exam window MUST be global: it opens at `scheduledAt` and
closes at `scheduledAt + durationMs + extraTimeMs`, at the same instant for
every student.

**FR-EXAM-021** — A student who starts late MUST get less time. There is no
per-student timer.

**FR-EXAM-022** — `Exam.extraTimeMs` MUST default to zero and MUST be writable
only from the web app. It MUST NOT be reachable from the CLI or the REST API.

**FR-EXAM-023** — Schedule fields MUST be frozen from `ONGOING` onwards
(FR-SYNC-033).

## Submissions

**FR-EXAM-030** — Submission MUST be per question. There is no single "hand in
the paper" action.

**FR-EXAM-031** — Question order MUST be fixed as authored. Choice order MUST be
shuffled per student, seeded from the student id and the question id, with no
stored state.

**FR-EXAM-032** — Submissions MUST be unlimited while the window is open, and
the **last** one MUST count.

**FR-EXAM-033** — `PRACTICE` exams MUST be exempt from FR-EXAM-032, scoring the
best attempt and returning feedback immediately (FR-GRD-002).

**FR-EXAM-034** — A submission arriving after the window closes MUST be rejected
outright. Nothing is written and nothing is flagged for later.

**FR-EXAM-035** — Questions already submitted MUST count, regardless of what was
left unanswered.

## Drafts

**FR-EXAM-040** — The server MUST keep at most one mutable draft per response,
overwritten in place.

**FR-EXAM-041** — A draft MUST be restored when the student reopens the exam
page.

**FR-EXAM-042** — Drafts MUST be saved on blur, on moving between questions, and
on an idle timer of roughly 60 seconds — not on a fast tick (see
`08-nonfunctional.md`).

**FR-EXAM-043** — Entering `CLOSED` MUST sweep drafts and promote them into
submissions for responses that have none.

**FR-EXAM-044** — Drafts MUST NOT be visible to instructors or bots. An
unsubmitted draft is not an answer until FR-EXAM-043 promotes it.

## Taking an exam

> As a student, I want to answer questions one at a time and know each one
> landed, so I never wonder whether my work was saved.

**Given** an `ONGOING` exam I am enrolled in
**When** I open it
**Then** I see the whole paper on one page, questions in the authored order,
choices shuffled for me
**And** any draft I left earlier is restored into the inputs

**When** I submit a single question
**Then** that question acquires a discrete confirmed marker once the server
acknowledges it
**And** the marker survives a page reload

**Given** the window has closed
**When** I submit
**Then** the submission is rejected, and my answer stays in the box so I can
copy it out

**Given** I answered question 3 but never pressed submit
**When** the window closes
**Then** my draft becomes my submission

## Results

**FR-EXAM-050** — Scores, correct answers, and feedback MUST be hidden until
`COMPLETED`, except in `PRACTICE` exams.

**FR-EXAM-051** — At `COMPLETED`, a student MUST see their score, the correct
answers, and any feedback.

**FR-EXAM-052** — A response awaiting manual grading MUST display "pending
grade" rather than a zero.

## Schema impact

- `ExamStatus` gains `CLOSED`, between `ONGOING` and `COMPLETED`.
- `Exam` gains `extraTimeMs Int @default(0)`.
- `Response` gains the `QuestionData` version it was answered against.
- New model for drafts: one row per response, mutable, holding a payload and a
  timestamp.

## Open questions

- **FR-EXAM-043 discards work.** A student who submits at minute 10, keeps
  editing until minute 90, and never resubmits loses those 80 minutes, because
  the response already has a submission. The alternative — promote whenever the
  draft is newer than the last submission — costs nothing and never loses work.
- Does an instructor see a live view of who has submitted what while the exam is
  `ONGOING`, or only after it closes?
