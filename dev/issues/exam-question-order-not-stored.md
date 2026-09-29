---
type: issue
status: open
tags: [exams, questions, schema, ordering]
relatedTo: [exam-service, web-grading]
---

# An exam does not keep the order of its questions

`QuestionsForExam` has the primary key `(examId, questionRefId)` and no
position column. `examInclude` in `src/db/services/exam.service.ts` reads the
rows without an `orderBy`, so `exam.questions` comes back in the order the
questions were created in the course, whatever order `create` or `update`
received.

## Effect

An instructor who pushes an exam with questions `[q3, q1, q2]` gets `q1, q2,
q3` on the student's exam page, the instructor's exam page and the grading
pages. Every page that says "in exam order" shows creation order.

## Reproduce

Create questions `a`, `b`, `c` in that order, then an exam with
`questions: [{ slug: "c" }, { slug: "a" }]`. `db.exam.findOne` returns
`a, c`.

## Fix

Add a `position Int` column to `QuestionsForExam`, fill it from the index in
`resolveQuestions`, and order by it in `examInclude`. Existing rows take their
current order. This needs a migration.
