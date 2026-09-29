---
type: note
status: active
tags: [exam-page, question-views, readonly, mdq-js]
relatedTo: [exam-attempt, question-views]
---

# Submitted answers are hard to read on the exam page

Seen on the student exam page after "Submit exam":

- A true/false statement the student left blank renders as "False", the same
  as an answered "False".
- The selected radio of a multiple-choice question is low contrast in
  `readonly` mode, so the chosen option is hard to spot.

The question views in `src/components/question/` are due to be replaced by
the mdq-js renderer. Fix both there once it is integrated, rather than in the
current views.

Tests for answer save and restore cover multiple choice and short answer
only; the other question types get covered when mdq-js lands.
