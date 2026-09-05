# Question rendering — true/false

## Scope

The third question type, following `question-rendering.md` and
`question-multiple-selection.md`: `score.trueFalse`, `answerKey.trueFalse`, a
`PublicTrueFalse` representation, and a `TrueFalseView` SolidJS component on
the `/design/questions` tab.

Shared decisions from those specs are not re-argued: stable ids, the public
half as the only thing a view receives, `markdown-it` with raw HTML off, three
view modes, per-choice feedback on `Scored`, grading strategies read
defensively until the JSON schema grows a `grading` field.

## Design decisions

### Abstaining is a third state, and it is the whole point

Multiple selection has two states per choice, because an unticked box asserts
"false". True/false has three: judged true, judged false, and **not judged**.
mdq.spec's grading is explicit that an unmarked statement "neither adds nor
subtracts points", which only means anything if abstaining is representable.

So the answer is a partial map: a statement the student judged has an entry,
one they skipped has none.

```ts
export type TrueFalseAnswer = { answers: Map<string, boolean> };
```

**This changes the declared type**, which was `Map<string, string>`. Nothing
consumed it yet. The string could only have meant a marker letter — `T`, `V`,
`F`, 真 — and a marker is an authoring artifact, not a student input: a student
clicking a toggle produces a judgement, not a letter. Turning `[V]` into
`correct: true` is the parser's job, already done by the time the server sees
the question, and the schema stores both halves (`correct` and `marker`)
precisely so nobody has to redo it downstream.

`AnswerKey<"true-false">` mirrors it as `Map<string, boolean>`, for the same
reason multiple selection's key is a `Set`: a review view compares the key to
the answer, and two different shapes make every comparison a conversion.

### Grading counts three buckets, not two

With `c` statements marked correctly, `w` marked wrongly, and `n` statements
total (`n − c − w` abstained):

| Strategy         | Score                            |
| :--------------- | :------------------------------- |
| `partial`        | `c / n`                          |
| `all-or-nothing` | `0` if `w > 0`, else `c / n`     |
| `symmetric`      | `(c − w) / n`                    |

`all-or-nothing` is the odd one, and mdq.spec spells out why: any wrong mark
zeroes the question, but abstaining is not a mistake, so a student who marks
only what they know gets credit proportional to it. That makes it "no mistakes"
rather than "everything answered", which is a different rule from the
multiple-selection strategy of the same name — worth knowing when the two sit
side by side in the showcase.

`[_, _, _, _]` scores 0 under all three, unlike multiple selection where
abstaining everything asserts "all false" and can score well. Same table shape,
opposite meaning, because the third state exists here.

All six rows of mdq.spec's worked example are pinned as tests.

### Feedback covers wrong answers *and* abstentions

mdq.spec: feedback shows for every statement the student got wrong **and**
every one they left unjudged, in document order, and nothing for one judged
correctly. Abstentions are included deliberately — a student who skipped a
statement because they did not know it is exactly who the explanation is for.

`Scored.choices` already carries this, unchanged from multiple selection.

### `marker` is private, because it is the answer key spelled differently

`PublicTrueFalse` strips `correct`, `feedback`, `comment` and — the one that is
easy to miss — `marker`. The letter an author wrote between the brackets is
`T` exactly when the statement is true, so shipping it would hand the student
the key in a field that does not look like one.

The consequence is that the view cannot label its toggle with the document's
own letters, so it labels them "True" and "False" in fixed text. A localized
label belongs to the question's `locale`, not to a per-statement marker;
that is a follow-up, not a reason to leak.

### The toggle is three-state, and the middle is the default

Each statement gets one control with three positions: **False** on the left
(error), **unmarked** in the middle (neutral), **True** on the right (success).
It starts in the middle, and a student can return to it — abstaining has to be
reachable, or the third state is only representable by never touching the
control, which is not the same thing as choosing to skip.

Whatever daisyUI markup this lands on, the requirement is a keyboard-operable
radio group of three per statement, not a click-handling div: three states is a
radio group's job, and a two-state `<input type="checkbox">` cannot express it.

### Review marks abstentions distinctly from mistakes

Three outcomes per statement, and the view can derive all of them from `value`
and `result.correct`: judged correctly, judged wrongly, and abstained.
Abstained is neither right nor wrong — it renders muted, not red, because the
grading does not penalize it under any strategy and a view that says otherwise
contradicts the score next to it.

### A frozen toggle keeps its color

daisyUI dims a `disabled` button to base-200, which would erase the one thing
`review` mode exists to show: what the student marked. Outside `answer` mode
the selected position therefore keeps its color explicitly, and only the
unselected positions dim.

The toggle's color encodes the *value* — True is green, False is red — while
the row tint and the check/x encode *correctness*. So a wrong "True" renders
as a green button inside a red row, which is the intended reading: this is
what you said, and it was wrong.

## Files

| File                                          | What                                                     |
| :-------------------------------------------- | :------------------------------------------------------- |
| `src/mdq/scoring.ts`                          | `TrueFalseAnswer` reshaped, `score.trueFalse`, `answerKey.trueFalse` |
| `src/mdq/public.ts`                           | `PublicTrueFalse`, `publicRepresentation.trueFalse`      |
| `src/components/question/TrueFalseView.tsx`   | The SolidJS component                                    |
| `src/components/question/QuestionView.tsx`    | A third dispatch arm                                     |
| `src/pages/design/questions.astro`            | True/false sections                                      |

`src/mdq/question.ts` needs no change: `dispatch` finds the new table entries
by name.

## Tests

In `test/mdq-question.spec.ts`:

- All six rows of mdq.spec's worked example, across all three strategies.
- `all-or-nothing` gives partial credit for a partly-answered, fully-correct
  paper, and zero the moment one mark is wrong — the rule that differs from
  multiple selection's strategy of the same name.
- An abstained statement neither adds nor subtracts under `symmetric`.
- A statement with `correct` omitted is false, per the schema's own default.
- Feedback appears for wrongly judged *and* abstained statements, in document
  order, and not for correctly judged ones.
- `answerKey()` is a `Map` of id to `correct`.
- `toPublic()` drops `marker` along with `correct`, `feedback` and `comment`.
