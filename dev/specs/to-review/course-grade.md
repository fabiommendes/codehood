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

- The configuration of the course grade lives in the course folder and
  reaches the server with `codehood push`. The web shows the result and
  never edits the rule (P8).
- The CSV download of the grades table ships first and does not depend on
  this spec. Done.
- A flat weight per exam is not enough. See the reference case.
- **Option C below.** The instructor computes the grades on their own
  machine and pushes the result as columns. Codehood defines no formula
  language: the computation is a Python function the instructor writes,
  which the CLI calls with the course's grades and whose result it pushes.
  The script is the instructor's, runs on their machine and reads only
  their own data, so it raises no security question. Hooking arbitrary
  Python into other CLI tasks is a later step; this is its first case.
- **The substitute exam** has no rule of its own. It is one more score the
  function reads. The two policies in use, replacing an exam the student
  missed with a justification and replacing the lowest score outright, are
  both written by the instructor.
- **Students in a pushed file** are identified by school id by default. The
  CLI already downloads the roster, so it can map any other field (GitHub
  username, email) to the student itself and send usernames to the server.

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

- **Missing and unfinished data.** What the function reads for an exam that
  is `Missed`, `Pending`, `In progress` or not yet held. Proposal: `None`
  for all four, with the state beside the score, so the function can tell
  a miss from a pending grade.
- **What the student sees, and when.** A pushed column built from exams
  whose results are not released would leak them (`resultsReleased` in
  `src/services/exam-state.ts`). Proposal: a column is hidden from students
  until the instructor releases it, on the web like an exam's results.
- **Scale and rounding.** Scores are stored in `[-1, 1]` and shown as whole
  percentages; the reference case grades from 0 to 10 and ends in a label.
  Proposal: a column is a number or a label, declared with the column, and
  the server shows numbers as pushed, with no scale of its own.
- **Which columns the table shows.** All pushed columns beside the exams,
  or a declared subset, and which one is "the" course grade.
- **The function's contract.** Its name and file, what it receives (one
  student's scores, or the whole table), and what it returns. Lives in the
  CLI's spec, not here.
- **Schema.** Where columns and their values are stored. This is a
  migration and needs approval before any code.
