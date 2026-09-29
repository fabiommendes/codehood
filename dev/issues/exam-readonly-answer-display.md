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
- The phase badge still reads "Open now" after the student submitted; their
  own state ("Submitted") is only in the body.

The question views in `src/components/question/` are due to be replaced by
the mdq-js renderer. Fix the first two there once it is integrated, rather
than in the current views. The badge is independent of that and can be fixed
on its own.

Tests for answer save and restore cover multiple choice and short answer
only; the other question types get covered when mdq-js lands.
