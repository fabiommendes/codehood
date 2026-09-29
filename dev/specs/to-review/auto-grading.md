---
type: spec
status: blocked
tags: [grading, exams, mdq-js]
relatedTo: [web-grading, feedback-service, submission-service, mdq-js]
---

# Automatic grading

## Blocked by

**mdq-js landing in this repository.** The grading rules belong to mdq-js and
this spec takes them as given and correct. It only covers connecting them to
the stored questions, the stored answers and the services. Work on it starts
once mdq-js is integrated and replaces `src/mdq/`.

## Context

Nothing grades an answer when a student submits it. A multiple-choice answer
waits for the instructor just like an essay does, so every exam needs a full
manual pass before its grades can be released. mdq-js knows how to grade the
question types that have a defined correct answer. This spec makes the server
apply those rules when an answer arrives.

## Glossary

- **Auto-gradable question**: a question for which mdq-js returns a score
  given an answer. Which types qualify is mdq-js's decision, not this spec's.
- **Pinned question**: the version of a question an exam references. An exam
  keeps pointing at it when the question is edited later.
- **Verdict**, **counting answer**, **pending answer**: as in
  [web-grading](web-grading.md).

## Requirements

### R1: An answer to an auto-gradable question is graded on arrival

When a submission is created for an auto-gradable question, the server grades
it with mdq-js and records the result as a grading pass on that submission.

Acceptance criteria:
- Given a multiple-choice question whose correct choice is "A base case", when
  a student submits that choice, then the submission has one pass with score 1.
- Given the same question, when the student submits the wrong choice, then the
  pass has the score mdq-js returns for it, zero or negative included.
- Given a student who submits twice to the same question, then each submission
  has its own pass, and the newest submission is the counting answer.
- Given an answer saved automatically by the exam page as the student types,
  then it is graded like any other submission.

### R2: The pass is attributed to the server's grader

An automatic pass has no human grader. Its bot is `codehood`, its `ref` is
`auto`, and the submission's status becomes `GRADED_AUTOMATICALLY`.

Acceptance criteria:
- Given an automatically graded submission, then its pass has `grader` null
  and `bot` "codehood", and the instructor's grading page reads "Graded
  automatically".
- Given the instructor changes that grade by hand, then the automatic pass is
  kept, the instructor's pass is the verdict, and the status is
  `GRADED_MANUALLY`.

### R3: Other answers wait for a human

A submission to a question mdq-js does not grade stays `PENDING_GRADE` with no
pass, and appears in the manual grading queue.

Acceptance criteria:
- Given an essay question, when a student submits an answer, then the
  submission has no pass and counts as pending once the attempt is closed.
- Given an exam of one multiple-choice and one essay question, when a student
  submits both and closes the attempt, then the exam has 1 pending answer.

### R4: Grading uses the pinned question

The answer is graded against the version of the question the exam pins, not
against the question's latest version.

Acceptance criteria:
- Given an exam pinning a question whose correct choice is A, and the question
  later edited so that B is correct, when a student answers A in that exam,
  then the score is 1.

### R5: Feedback text from the question reaches the student

When mdq-js returns feedback text for an answer, it is stored as the pass's
comment and shown to the student under the same release rule as any grade.

Acceptance criteria:
- Given a choice with feedback "Correct: without a base case the recursion
  never stops", when a student picks it, then the pass carries that comment.
- Given an `EXAM` whose grades are not released, then the student sees neither
  the score nor the comment.
- Given a `PRACTICE` exam, then the student sees both as soon as the answer is
  saved.

### R6: A grading failure never loses the answer

When grading fails, the submission is saved and left pending, and the failure
is logged with the submission's public id and the question's slug.

Acceptance criteria:
- Given mdq-js throws while grading, then the student's request succeeds, the
  submission is stored with status `PENDING_GRADE` and no pass, and the answer
  appears in the manual queue.
- Given a stored question that mdq-js rejects as malformed, then the same
  holds, and the instructor's home page lists the question under problems.

### R7: Answers that arrived before this change can be graded

A management command grades the existing submissions of auto-gradable
questions that have no pass yet.

Acceptance criteria:
- Given `pnpm run manage grade-pending cs101 ada 2026-1`, then every
  submission in that course without a pass, to an auto-gradable question,
  gets an automatic pass, and the command prints how many it graded and how
  many it left for a human.
- Given the command run twice, then the second run grades nothing.
- Given a submission that already has a pass, human or bot, then the command
  leaves it alone.

## Out of scope

- The grading rules themselves, partial credit and penalties included. They
  are whatever mdq-js returns.
- Grading programming answers by running code. That stays with external bots.
- Re-grading after an answer key is corrected. See follow-ups.
- The manual grading pages. See [web-grading](web-grading.md).

## Assumptions

Choices made without the requester's answer:

- An answer is graded when it is saved, not when the attempt closes. Practice
  exams need the result at once, and a deadline passing is not an event the
  server acts on.
- One automatic pass per submission, under the fixed ref `auto`.
- The bot id is `codehood`.

Answered by the requester:

- The grading rules exist in mdq-js and are correct.
- mdq-js landing blocks this spec.

## Open questions

These belong to the mdq-js integration and block the requirements listed:

1. How does a stored question (the JSON in the database) become the question
   object mdq-js grades? Blocks R1, R4.
2. Is the submission payload the exam page stores today the answer format
   mdq-js expects, or does it need a conversion? Blocks R1.
3. How does mdq-js report "this type has no automatic grade", as opposed to
   failing? Blocks R3, R6.
4. Does mdq-js return scores as exact fractions? The feedback service stores
   a decimal or `n/d` string in `[-1, 1]`. Blocks R1.

## Possible follow-ups

- Re-grade an exam after its answer key is corrected, appending a new
  automatic pass and keeping the old one.
- Show the student which choice was correct after release.
