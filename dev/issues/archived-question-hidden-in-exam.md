---
type: issue
status: completed
tags: [questions, exams, visibility]
relatedTo: [question-service, exam-page]
closed: 2026-10-29
---

# Archiving a question removes it from an open exam

`QuestionService.findOne` returns `null` to non-authors for an ARCHIVED
question, and `exams/[slug].astro` drops those. Archiving a question during
an open exam makes it disappear from every student's attempt, although
archiving should never retroactively hide a question an exam references.

Related: a user with no access to the course gets `null` for a draft or
archived question but `NotAllowed` for a published one, which lets them probe
which slugs exist.

Fixed: `QuestionService.findOneTx` refuses an outsider before looking at the
status, and lets a non-author read an archived question that an exam pins.
The exam page also reads each question at the version the exam pins; it used
to show the latest one.
