---
type: spec
status: draft
tags: [grading, course-grade, cli, instructor]
relatedTo: [web-grading, grades-table, exam-result, codehood-toml]
---

# The course's final grade

## Context

The Grades tab shows every student against every exam and has no total. The
instructor downloads the table as CSV and computes the final grade in a
spreadsheet. This spec decides how much of that computation Codehood takes
over.

This is a draft. The sections under "Decided" hold; everything under "Open"
waits for an answer, and no requirement is numbered until they are settled.

## Decided

- The configuration of the course grade lives in the course folder's
  `codehood.toml` and reaches the server with `codehood push`. The web shows
  the result and never edits the rule (P8).
- The CSV download of the grades table ships first and does not depend on
  this spec.
- A flat weight per exam is not enough. See the reference case.

## Reference case

One real course, which the design must be able to express. Other courses
will differ.

1. Exams, each with a weight.
2. A substitute exam, which replaces the score of one of the exams.
3. Assignments, graded outside Codehood, with a weight of their own.
4. The weighted result converts to a UnB letter grade: SS, MS, MM, MI, II,
   SR.
5. A student reaches a minimum letter grade by meeting criteria that are not
   part of the weighted result, such as a score on the final assignment at or
   above some value.

What this case needs beyond weights:

- **Scores from outside.** Items 3 and 5 read grades that no exam in Codehood
  produces.
- **Replacement.** Item 2 picks between two scores for each student.
- **Bands.** Item 4 maps a number to a label.
- **Conditions.** Item 5 overrides the band when a condition holds.

## Options

### A. Formulas in `codehood.toml`

The file declares named values as expressions over exam slugs and external
columns, with a small set of functions (`max`, `min`, `mean`, `drop_lowest`,
`if`), a table of bands, and rules that raise the band. The server evaluates
them.

- Students and the instructor see the course grade on the web, always
  current.
- It is a programming language: grammar, evaluator, error messages, a
  version to keep compatible, and one more course that needs a function the
  language lacks.

### B. Pushed grade columns

The instructor computes whatever they want, with a script or a spreadsheet,
and pushes the result as data: a CSV in the course folder with one row per
student and one column per grade item. The server stores the columns and
shows them beside the exams. The final grade is one of those columns.

- No language to design. Every scheme is expressible, because the
  computation runs on the instructor's machine.
- It also solves item 3 on its own: assignments graded elsewhere become
  columns.
- The course grade is only as current as the last push.

### C. B now, A over its columns later

B ships first. Formulas, if they come, read exam slugs and pushed columns
alike, so nothing in B is thrown away.

**Recommendation: C.** The reference case needs external scores whatever
else is chosen, so pushed columns are required work and not a detour. They
make the final grade visible to students with no formula language at all.
Formulas are worth their cost only once pushing a computed column proves to
be a chore.

## Open

- **Which option.** A, B or C.
- **The substitute exam.** Whether it replaces a chosen exam, the lowest
  one, or the one that raises the result the most, and whether a student who
  scores lower on it keeps the original.
- **Identifying students in a pushed file.** By username, school id or
  email, and what happens to a row that matches no enrolled student.
- **Missing and unfinished data.** What a formula reads for an exam that is
  `Missed`, `Pending`, `In progress` or not yet held.
- **What the student sees, and when.** A course grade built from exams whose
  results are not released would leak them (`resultsReleased` in
  `src/services/exam-state.ts`). Pushed columns need a release rule of their
  own.
- **Scale and rounding.** Scores are stored in `[-1, 1]` and shown as whole
  percentages; the reference case grades from 0 to 10 and ends in a label.
- **Schema.** Where columns and their values are stored. This is a
  migration and needs approval before any code.
