---
type: note
status: active
tags: [mdq-js, scoring, fill-in]
relatedTo: [question-fill-in]
---

# Fill-in: a choice priced at score 0 costs -1

In the symmetric case, a wrong blank costs `score < 0 ? score : -1`
(`src/mdq/scoring.ts`). A choice the author explicitly priced at `score: 0`
therefore costs -1, although a score in the body overrides the grading
strategy. Choice blanks also carry no `grading`, so `Scored.blanks` shows the
symmetric fallback under a `partial` question.

Fix in mdq-js when it replaces `src/mdq/`, not in the current scoring.
