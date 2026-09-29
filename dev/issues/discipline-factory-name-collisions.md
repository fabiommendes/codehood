---
type: note
status: active
tags: [fixtures, flaky-test, discipline-factory]
relatedTo: [discipline-factory, student-finding-course-material]
---

# Discipline factory names collide, so "student: see my courses" is flaky

`src/fixtures/discipline.factory.ts` draws `name` from
`faker.commerce.department()`, a pool of about twenty values. The story
`student: see my courses` creates two courses and asserts the second one's
discipline name is absent from the student's list; when both draw the same
name the assertion fails. Seen once in a full run on 2026-09-28, green on
rerun.

Fix: make the generated name unique (append the slug or a counter) and check
no test relies on the raw department names.
