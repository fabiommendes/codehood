---
type: note
status: backlog
tags: [exam-page, tests, mdq-js]
relatedTo: [exam-attempt, question-views]
---

# Answer save and restore is tested for short answer only

`test/stories/student-exams.test.ts` reloads the exam page and checks the
restored answer for a short-answer question only. Multiple choice, multiple
selection, true/false, numeric, fill-in and ordering answers have no
save-and-restore test, although the mdq-js views now render all of them on
the exam page.
