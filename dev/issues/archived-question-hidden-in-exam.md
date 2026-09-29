---
type: note
status: active
tags: [questions, exams, visibility]
relatedTo: [question-service, exam-page]
---

# Archiving a question removes it from an open exam

`QuestionService.findOne` returns `null` to non-authors for an ARCHIVED
question, and `exams/[slug].astro` drops those. Archiving a question during
an open exam makes it disappear from every student's attempt, although
archiving should never retroactively hide a question an exam references.

Related: a user with no access to the course gets `null` for a draft or
archived question but `NotAllowed` for a published one, which lets them probe
which slugs exist.
