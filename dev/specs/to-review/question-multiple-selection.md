# Question rendering — multiple selection

## Scope

The second question type, following the shape `question-rendering.md` set for
multiple choice: `score.multipleSelection`, `answerKey.multipleSelection`, and
a `MultipleSelectionView` SolidJS component, showcased on the existing
`/design/questions` tab.

Everything that spec decided still holds and is not re-argued here — stable
choice ids from `resolveChoiceIds`, the public half as the only thing a
component receives, `markdown-it` with raw HTML off, the three view modes,
grading strategies read defensively until `public/mdq.schema.json` grows a
`grading` field.

Out of scope: shuffling, submissions, the remaining five types.

## Design decisions

### Every choice is judged, including the ones left unticked

mdq.spec is explicit (`multiple-selection.md`, "Grading"): an unticked choice
asserts that the choice is false, and there is no third state. So scoring walks
all `n` choices and counts how many the student *judged correctly* — ticked and
correct, or unticked and incorrect — rather than looking only at what was
ticked.

With `r` choices judged correctly out of `n`:

| Strategy         | Score           |
| :--------------- | :-------------- |
| `partial`        | `r / n`         |
| `all-or-nothing` | `1` if `r === n`, else `0` |
| `symmetric`      | `(2r − n) / n`  |

`symmetric` is "right minus wrong over n", which is the same thing: the wrong
count is `n − r`, so `(r − (n − r)) / n`. It is the default, as it is for
multiple choice, and it is the only one that can go negative — clamped nowhere,
same as multiple choice, because the exam's `penalty` policy owns that call.

All six rows of the spec's worked example are pinned as tests.

### An empty answer is graded, not skipped

mdq.spec says a skipped question shows no feedback "because its grading formula
never runs", but its own table grades `[_, _, _, _]` as `[F, F, F, F]` and
scores it. Both are right, at different layers: *skipped* means no answer was
submitted at all, which is a submission-model state that does not reach
`score()`. An answer that reaches `score()` with an empty `choices` set is a
student asserting every choice is false, and it is graded as such.

Since there is no submission model yet, `score()` simply never sees the skipped
case, and nothing here has to represent it.

### Feedback is per choice, so `Scored` grows a place to put it

Multiple choice has one feedback string — the picked choice's. Multiple
selection has up to `n`, shown only for the choices judged **wrongly**, in
document order, including choices the student never ticked. A single `feedback`
string cannot carry that, and joining them into one loses which choice each
belongs to, which is exactly what a view wants in order to render it inline.

`Scored` therefore gains an optional `choices: ChoiceFeedback[]`, alongside the
scalar `feedback` multiple choice already uses:

```ts
export type ChoiceFeedback = { id: string; feedback: string };
```

True/false will want the same field for the same reason, which is the argument
for putting it on `Scored` rather than inventing a per-type result shape.

A student who answers perfectly gets an empty list, not an absent one: "you got
everything right" and "this question has no feedback" are different, and the
view renders them differently.

### The answer key is a `Set`, mirroring the answer

`AnswerKey<"multiple-selection">` is already declared as `Set<string>` — the
ids whose `correct` is true. It mirrors `MultipleSelectionAnswer`, so the view
compares two sets rather than a set against a list.

A `Set` does not survive `JSON.stringify`. That is fine inside the process and
a problem the day this crosses the API, which is the exam slice's to solve; the
alternative — making the key a list while the answer is a set — moves the cost
into every comparison instead.

### The view derives per-choice correctness, and never gets it handed over

`MultipleSelectionView` in `review` mode has both `value` (what the student
ticked) and `result.correct` (what should have been ticked), so whether each
row was judged correctly is a set membership test it can do itself. There is no
third prop describing per-row state, because two sources that can disagree is
one more than the view needs.

Rows are marked on *judgement*, not on ticked-ness: a correct choice the
student left unticked reads as a mistake, which is what the grading says it is.

## Files

| File                                                | What                                     |
| :-------------------------------------------------- | :--------------------------------------- |
| `src/mdq/scoring.ts`                                | `ChoiceFeedback`, `score.multipleSelection`, `answerKey.multipleSelection` |
| `src/components/question/MultipleSelectionView.tsx` | The SolidJS component                    |
| `src/components/question/QuestionView.tsx`          | A second dispatch arm                    |
| `src/pages/design/questions.astro`                  | Multiple-selection sections              |

`src/mdq/public.ts` already emits `PublicMultipleSelection`, and
`src/mdq/question.ts` needs no change: `dispatch` finds the new table entries
by name.

## Tests

In `test/mdq-question.spec.ts`:

- All six rows of mdq.spec's worked example, across all three strategies.
- A choice with `correct` omitted is incorrect, per the schema's own default.
- Feedback appears only for wrongly judged choices, in document order, and
  includes a correct choice the student left unticked.
- A perfect answer yields an empty feedback list, not an absent one.
- An empty answer set grades every choice as false rather than short-circuiting.
- An answer naming a choice that does not exist ignores it rather than throwing,
  and does not let it count as a judgement.
- `answerKey()` returns the `correct` ids as a `Set`, and an empty `Set` when
  no choice is correct.
- `toPublic()` drops `correct`, `feedback` and `comment` from every choice.
