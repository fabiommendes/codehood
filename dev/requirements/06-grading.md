# Grading

## Automatic pre-grading

**FR-GRD-001** — The server MUST pre-grade auto-gradable question types by
hydrating an `mdq-js` question from the merged payloads and asking it to score
the submission. The server MUST NOT implement scoring logic of its own.

**FR-GRD-002** — `PRACTICE` submissions MUST be graded synchronously at submit
time, so feedback is immediate.

**FR-GRD-003** — All other exams MUST be graded during the `CLOSED` sweep, and
MUST grade only the submission that counts. Superseded attempts MUST NOT be
graded.

**FR-GRD-004** — Grading MUST use the `QuestionData` version the response was
answered against, not the current one.

> Without FR-GRD-004 a mid-exam edit — even a permitted, grade-neutral one —
> means half the class is scored against a different object than the other half,
> with nothing anywhere reporting an error.

**FR-GRD-005** — A submission the server cannot grade automatically MUST be left
`PENDING_GRADE`. It MUST NOT be scored zero by default.

## Manual grading and override

**FR-GRD-010** — An instructor MUST be able to grade or override a submission
with `PATCH`/`PUT` on the response resource. The write MUST apply to the
submission that counts (FR-EXAM-032).

**FR-GRD-011** — An override MUST update the submission in place — score,
feedback, grader, status — and MUST NOT append a new submission row.

> Appending would make the instructor's edit the last submission and silently
> replace the student's answer under FR-EXAM-032's rule.

**FR-GRD-012** — When an override changes a score that was set automatically,
the original value MUST be preserved in `overriddenFrom`.

**FR-GRD-013** — `overriddenFrom` MUST be instructor-facing. The student sees
the final score only.

**FR-GRD-014** — Manual grading MUST set `status = GRADED_MANUALLY` and record
`graderId`.

## Voiding a question

**FR-GRD-020** — An instructor MUST be able to void a question within an exam.
Voiding MUST be recorded on `QuestionsForExam`, not per submission.

**FR-GRD-021** — Voiding MUST mark every affected submission `WILL_NOT_GRADE`,
including for students who never answered.

**FR-GRD-022** — How a void affects the score MUST be delegated to `mdq-js`,
configured per question and carried in its payload.

## Bots

**FR-GRD-030** — A grading bot MUST be able to read responses and submissions in
its owner's courses, and write scores, feedback, and grading status.

**FR-GRD-031** — A bot MUST NOT write content of any kind (FR-ACC-023).

**FR-GRD-032** — Code questions MUST be graded by a bot that owns its own
sandbox. The server MUST NOT execute submitted code, ever.

**FR-GRD-033** — Bot writes MUST use the same endpoints as instructor writes, so
there is one grading contract rather than two.

## Feedback

**FR-GRD-040** — `feedbackData` MUST carry structured, machine-produced feedback
— failing test names, which option was wrong and why.

**FR-GRD-041** — `feedback` MUST carry human prose.

**FR-GRD-042** — Both MUST be revealed to the student at `COMPLETED`
(FR-EXAM-051), and neither before.

## The gradebook

**FR-GRD-050** — The gradebook MUST present per-exam scores. The server MUST NOT
compute a course-level total in V1.

**FR-GRD-051** — A student with no submission for a closed exam MUST score zero
for that exam.

**FR-GRD-052** — Dropped students' submissions MUST remain visible to the
instructor (FR-CRS-044).

## Schema impact

- `Submission` gains `overriddenFrom Float?`.
- `QuestionsForExam` gains `voidedAt DateTime?`.

## Open questions

- Does the student see *that* a grade was overridden — a "regraded" marker —
  even though they do not see the previous value? FR-GRD-013 currently says no.
- Is there a bulk grading view for an essay question across the whole class, or
  does the instructor work student by student?
