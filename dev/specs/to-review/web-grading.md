---
type: spec
status: implemented
tags: [grading, exams, instructor, web]
relatedTo: [feedback-service, exam-result, auto-grading, instructor-home]
---

# Grading on the web

## Context

A student who submits an exam sees "Awaiting grading", and nothing on the web
lets the instructor change that. The feedback service already stores grading
passes, but only fixtures and the REST-less bot path write them. This spec
gives the instructor a grading queue per exam, a view of one student's
attempt, and the class's results across exams. It covers the stories "Grade
submissions by hand" and "See the whole class's results".

It does not depend on [auto-grading](auto-grading.md). Until that lands, every
answer waits for a human, objective questions included. Once it lands, the
queue shrinks to what needs a human, with no change to this spec.

## Glossary

Terms already in `GLOSSARY.md` keep their meaning: Response (one student's
attempt at an exam), Submission (one answer to one question).

- **Counting answer**: the newest submission a student made to a question
  within an attempt. Older submissions to the same question are history.
- **Verdict**: the score of the newest grading pass on a counting answer.
- **Pending answer**: a counting answer in a closed attempt with no verdict
  and not marked will-not-grade.
- **Closed attempt**: an attempt that no longer accepts answers, because the
  student submitted it or its deadline passed.
- **Will-not-grade**: an instructor's decision that an answer gets no grade.
  It scores zero in the total and is reported as "Not graded", never as 0%.

## Requirements

All pages below belong to a course and use its URL prefix
`/<discipline>/<instructor>_<edition>`, written `<course>`. Only the course's
instructor may open them. Practice exams are excluded everywhere in this spec.

### R1: Only the course's instructor grades

The grading pages and actions refuse everyone but the course's instructor.

Acceptance criteria:
- Given student `hopper` enrolled in `cs101`, when she opens
  `<course>/exams/midterm/grading`, then the response is 403.
- Given admin `admin` who does not teach `cs101`, when they open the same URL,
  then the response is 403.
- Given `hopper` again, when she opens `<course>/exams/no-such-exam/grading`,
  then the response is also 403: the refusal comes before the lookup, so it
  does not reveal which exams exist.
- Given an anonymous visitor, when they open the same URL, then they are
  redirected to `/login`.
- Given instructor `ada` of `cs101`, when she opens the URL of an exam slug
  that does not exist, then the response is 404.

### R2: The exam page lists the attempts

For the instructor, the exam page `<course>/exams/<slug>` shows a "Results"
section with one row per student who has an attempt.

Each row shows the student's name, the attempt's state ("In progress" or
"Submitted"), how many questions they answered out of the exam's total, how
many of their answers are pending, and their total. The total follows the
existing rule: a percentage when no answer is pending, "Pending" otherwise.
Rows sort by student name. Each row links to that student's attempt (R8).

Acceptance criteria:
- Given a closed exam of 3 questions where `hopper` answered 2 and one answer
  is pending, then her row reads "Submitted", "2 of 3 answered", "1 pending",
  total "Pending".
- Given the same exam once her pending answer is graded 1/2 and the other
  100%, then her total reads "50%" (mean of 1, 0.5 and 0 for the unanswered).
- Given an exam nobody attempted, then the section reads "No attempts yet."
- Given an exam with pending answers, then the section has a link "Grade
  answers (N pending)" to `<course>/exams/<slug>/grading`, with N the number
  of pending answers. With none pending the link reads "Review grades".
- Given a student with a `DROPPED` enrollment who has an attempt, then their
  row is still listed, marked "dropped".

### R3: The grading queue lists the exam's questions

`<course>/exams/<slug>/grading` lists the exam's questions in exam order. Each
entry shows the question's title and type, and how many counting answers are
pending, graded, and will-not-grade.

Acceptance criteria:
- Given an exam with questions `q-essay` (4 answers, none graded) and `q-mc`
  (4 answers, all graded), then `q-essay` reads "4 pending" and `q-mc` reads
  "4 graded", and each links to `<course>/exams/<slug>/grading/<question>`.
- Given every answer of the exam has a verdict or is will-not-grade, then the
  page reads "Nothing left to grade." and links back to the exam page.
- Given a question nobody answered, then its entry reads "No answers".
- Given an attempt still in progress, then its answers are counted nowhere on
  this page.

### R4: Grading goes question by question

`<course>/exams/<slug>/grading/<question>` shows the question as the student
saw it, its correct answer when the question defines one, and every counting
answer to it from closed attempts. Pending answers come first, in submission
order, then the rest under "Graded".

Acceptance criteria:
- Given 3 pending answers and 2 graded ones, then the page shows 3 answers
  with a grading form, followed by a "Graded" section with 2 answers.
- Given a student who submitted twice to the question, then only the newest
  submission is shown.
- Given a question slug that is not part of the exam, then the response is 404.
- The page links to the previous and next question of the exam, and back to
  the queue.

### R5: Answers are anonymous by default

On the page of R4 each answer is labelled "Answer 1", "Answer 2", in display
order, with no student name. A "Show names" switch reveals the names. The
choice is kept while the instructor moves between questions of the same exam.

Acceptance criteria:
- Given the page just opened, then no student name or username appears in it.
- Given the instructor turns "Show names" on, then each answer shows the
  student's name, and the next question opens with names shown.

### R6: Grading an answer records a pass

Each answer's form has a score, as a whole percentage from 0 to 100, and an
optional comment. Saving records a new grading pass by the instructor and
marks the submission `GRADED_MANUALLY`. The answer moves to "Graded" and the
next pending answer takes focus.

Acceptance criteria:
- Given a pending answer, when the instructor saves score `75` and comment
  "Missing the base case", then the answer has one pass with score 0.75, that
  comment and `ada` as grader, and the queue's pending count drops by one.
- Given score `101`, `-5`, `7.5` or an empty score, then nothing is saved and
  the form reads "Score must be a whole number between 0 and 100."
- Given a comment of only spaces, then the pass is saved with no comment.
- Given the grades are not released, then the student still sees "Awaiting
  grading" and no score.
- Given the same answer open in two tabs and graded in both, then both passes
  are kept and the one saved last is the verdict.

### R7: A grade can be changed

Every graded answer shows its verdict, its comments newest first, and who
graded it: the grader's name, or "Graded automatically" for a bot's pass.
"Change grade" opens the same form as R6 and appends a new pass. Earlier
passes are kept.

Acceptance criteria:
- Given an answer a bot graded 0%, when the instructor changes the grade to
  50 with comment "Accepting the alternative spelling", then the verdict is
  50%, both passes are listed, and the submission is `GRADED_MANUALLY`.
- Given the exam's grades are already released, when a grade changes, then
  the student sees the new score and comment on their next page load.

### R8: One student's attempt can be read whole

`<course>/exams/<slug>/attempts/<username>` shows one student's attempt: their
name, when they started and submitted, their total, and every question with
their counting answer read-only, its verdict and its comments. Each answer
links to its place in the grading page of R4.

Acceptance criteria:
- Given `hopper` answered 2 of 3 questions, then the page shows 3 questions,
  the third marked "Not answered".
- Given a username with no attempt at the exam, then the response is 404.
- Given an attempt in progress, then the page shows the answers saved so far
  and no grading links.

### R9: An answer can be marked will-not-grade

Each pending or graded answer has a "Will not grade" action that asks for an
optional comment. It marks the submission `WILL_NOT_GRADE`.

A will-not-grade answer is not pending, scores zero in the total, and reads
"Not graded" wherever a score would appear, for the instructor and, after
release, for the student, together with the comment. Grading it afterwards
(R6) makes it a graded answer again.

Acceptance criteria:
- Given a student with answers graded 100% and 100% and a third marked
  will-not-grade, then their total is 67% and the exam has no pending answer.
- Given that attempt after release, then the student sees "Not graded" on the
  third question, not "0%" and not "Waiting to be graded".
- Given a will-not-grade answer, when the instructor saves score `40`, then it
  is graded 40% and the submission is `GRADED_MANUALLY`.
- Given an exam whose only unresolved answers are will-not-grade, then its
  grades can be released.

### R10: The class's results are one table

`<course>/grades` shows every student against every exam, and is reached by a
"Grades" tab that only the instructor sees.

Rows are the students with an `ACTIVE` enrollment, by name. Columns are the
course's exams of type `EXAM` and `QUIZ` that are neither draft nor archived,
by scheduled date, unscheduled ones last. A cell shows:

| Situation                                   | Cell          |
| :------------------------------------------ | :------------ |
| Closed attempt, no pending answer           | the total, `83%` |
| Closed attempt, some answer pending         | `Pending`     |
| Attempt in progress                         | `In progress` |
| No attempt, exam closed                     | `Missed`      |
| No attempt, exam upcoming or open           | empty         |

A cell with an attempt links to that attempt (R8). Each column header links
to the exam page and shows, below the title, the mean of the totals in the
column and how many students attempted, as "avg 71% · 18 of 24". `Missed`,
`Pending` and `In progress` cells are left out of the mean.

Acceptance criteria:
- Given students A (80%), B (60%), C (missed) and D (one answer pending) on a
  closed exam, then the column reads "avg 70% · 3 of 4".
- Given a course with no exams, then the page reads "No exams yet."
- Given a course with exams and no enrolled students, then the page reads "No
  students enrolled yet." and links to the Students tab.
- Given a student who dropped the course, then they have no row.
- Given the exams' grades are not released, then the table still shows the
  totals: release controls what students see, not what the instructor sees.
- On a narrow screen the table scrolls sideways with the student column fixed.

### R11: The home page leads to the queue

On the instructor's home page, each item under answers waiting to be graded
links to that exam's grading queue (R3) instead of the exam page.

Acceptance criteria:
- Given `midterm` of `cs101` has 3 pending answers, then the item reads
  "3 answers to grade" and links to `<course>/exams/midterm/grading`.

## Out of scope

- Grading automatically. See [auto-grading](auto-grading.md).
- Practice exams, in the queue and in the grades table.
- Negative scores and fractions finer than a whole percentage. The REST API
  and the CLI still accept them, and the web displays them rounded.
- Deleting a grading pass from the web.
- Editing a student's answer or reopening a closed attempt.
- Weighted questions and weighted exams. Every question counts the same and
  the table has no course total.
- Several graders per course. Only the course's instructor grades.

## Assumptions

Choices made without the requester's answer:

- The queue is built per exam, not across the course.
- Scores are whole percentages on the web.
- Will-not-grade counts as zero in the total. The alternative, leaving the
  question out of the mean, would let a student gain from a blank answer.
- The grades table lives at `<course>/grades`, since `<course>/gradebook`
  was removed for showing fabricated data and now answers 404.
- An attempt in progress shows its total as "—" in the exam's results.
- "Show names" is the query parameter `names=1`, so no student name reaches
  the page unless it is asked for.
- The comment of a will-not-grade is stored as a grading pass with score
  zero; the submission's status decides what is shown.
- Rubrics are left out. The comment field is free text.

Answered by the requester:

- Grading goes question by question, not student by student.
- Auto-grading is a separate spec, blocked until mdq-js lands.
- R10 stays, with its own tab. A course total is a separate feature: the
  requester favors a configuration on the course (weighted means, maybe
  formulas over exam slugs) over a weight on each exam.

## Open questions

None that block a requirement.

## Possible follow-ups

- Download the grades table as CSV.
- Keyboard shortcuts in the grading page: save and next.
- Reusable comments, so a repeated mistake is described once.
- A course total with weights per exam.
- Notify students when grades are released or changed.
