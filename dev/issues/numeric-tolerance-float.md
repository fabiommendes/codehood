---
type: note
status: active
tags: [mdq, scoring, numeric, mdq-js]
relatedTo: [question-numeric]
---

# Numeric questions reject values on the tolerance boundary

`src/mdq/numeric.ts` compares the error with the tolerance in exact floating
point. Values the spec says are accepted are rejected:

- answer 1, `absolute: 0.1`, response 1.1 (error 0.10000000000000009);
- answer 3.14, `absolute: 0.005`, response 3.135;
- answer 1, `relative: 0.05`, response 1.05.

The boundary test uses 0.5, which is exact in binary. Compare with a small
relative epsilon and test with decimal values. Fill-in numeric blanks share
the rule. May be moot once mdq-js replaces `src/mdq/`.
