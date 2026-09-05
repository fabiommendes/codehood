# Question rendering — numeric

## Scope

The fifth question type, following `question-rendering.md`,
`question-multiple-selection.md`, `question-true-false.md` and
`question-essay.md`: `score.numeric`, `answerKey.numeric`, a `PublicNumeric`
representation, and a `NumericView` SolidJS component on the
`/design/questions` tab.

Shared decisions from those specs are not re-argued: the public half as the
only thing a view receives, `markdown-it` with raw HTML off, three view modes,
`QuestionResult` carrying the key separately from the payload, nothing
clamping the score.

## Design decisions

### Grading is binary, and there is no strategy to pick

mdq.spec is explicit: a response inside the tolerance scores 1, anything else
scores 0, and *"there is no partial credit for being close — the tolerance is
the only notion of closeness the format has"*. It says as plainly that numeric
questions take no `grading` field, because the three strategies have nothing
to select between.

So `score.numeric` does not call `grading()` and does not touch
`GradingStrategy`. It is the first type since multiple choice where the
strategy machinery is simply not part of the answer.

A response is accepted when **either** tolerance admits it:

```
|submitted − answer| ≤ absolute            (absolute, default 0)
|submitted − answer| ≤ |answer| × relative (relative, when declared)
```

Two details the schema settles that the prose leaves open:

- `tolerance.relative` is stored as a **fraction**, not a percentage: mdq.spec
  writes `5%`, the generated schema stores `0.05`. Scoring reads the schema's
  number and never divides by 100.
- The schema's docstring states the relative test as
  `|submitted − answer| / |answer| ≤ relative`, which divides by zero on a
  question whose answer is 0. The multiplied form above is equivalent
  everywhere the division is defined and finite where it is not, so that is
  what is implemented. Worth raising upstream.

With no tolerance at all, `absolute` defaults to 0 and the test is exact
equality. That is mdq.spec's own position — leniency is spelled by widening
the tolerance, not by the grader guessing — and it means an author who wants
float slack has to say so.

### A blank answer is representable

```ts
export type NumericAnswer = { value: number | null };
```

`null` is "left the box empty", and it scores 0. The choice types can express
an unanswered question in their own shape — an empty set, an absent map
entry — and numeric cannot without this, since every actual number is a real
answer. `NaN` was the alternative and is a worse one: it propagates silently
through arithmetic and compares false to itself.

`AnswerKey<"numeric">` is `number`, the bare payload, as essay's key is the
bare model-answer string. Never `null`: the schema makes `answer` required, so
a well-formed numeric question always has one.

The key deliberately does **not** carry the tolerance. A review screen does not
need it — `result.score` already says whether the student was inside it — and
an instructor screen has the whole question. Shipping the grading rule
alongside the key would put a field in the student's payload that exists only
to be re-implemented there.

### `unit`, `domain` and `decimalPlaces` are public; `answer` and `tolerance` are not

The three kept fields describe the *input box*: what unit to label it with, what
kind of number it accepts, and how many decimals to show. None of them narrows
the answer down — `decimalPlaces: 2` says how to format, not what to format.

`answer`, `tolerance` and `comment` are stripped.

### The public half resolves `domain`, and cannot resolve `fraction`

mdq.spec infers an omitted `domain` from the representation of the value and
the absolute tolerance, ranking `integer < fraction < decimal` and taking the
maximum. `publicRepresentation.numeric` runs that inference so the view is
handed a concrete domain rather than reimplementing the coercion table.

**It can never infer `fraction`.** The inference is defined over how the
numbers were *written*, and by the time a question reaches this code the schema
has parsed them: `answer` and `tolerance.absolute` are JavaScript `number`s, so
`-1/3` is indistinguishable from `-0.333…`. What survives the parse is
integer-vs-decimal, and that is what `numericDomain` returns when `domain` is
absent:

| declared | `answer` and `tolerance.absolute` | inferred  |
| :------- | :-------------------------------- | :-------- |
| any      | —                                 | declared  |
| absent   | both integral                     | `integer` |
| absent   | either non-integral               | `decimal` |

A fraction question therefore has to declare `domain: "fraction"`, which the
parser that read `[numeric]: -1/3` is in a position to do and this code is not.
Recorded under "Known gaps"; it is not a defect in the inference so much as
information the schema does not carry.

### The input is a number box, except for fractions

`integer` and `decimal` get `<input type="number">` — spinners, a numeric
keypad on mobile, and a `step` derived from `decimalPlaces` (`1` for integers,
`10⁻ᵈ` otherwise, `any` when unspecified).

`fraction` gets `<input type="text">` with `inputmode="text"`, because a number
input rejects `1/3` outright and a domain the student cannot type in is not a
domain. The view parses `a/b` as well as a plain decimal, and hands the model
layer the `number` it always wanted. Anything unparseable is `null`, which is
the same as blank — an uninterpretable response is not a wrong number, it is no
number.

`unit` renders as a suffix inside the input, per mdq.spec's "or use it just as
a visual cue in the response input field". **No unit conversion is performed.**
mdq.spec makes it a MAY, and a converter that silently reads `1kg` as `1000`
in a box labelled `g` would be doing arithmetic the student cannot see. Listed
as a gap rather than done badly.

### A frozen number box is still a number box

Unlike essay, `readonly` and `review` keep the input and disable it. The essay
departure was about a textarea hiding a long answer behind a scrollbar; a
disabled number input shows its one value completely. So numeric goes back to
the rule the choice views follow, and the disabled input keeps its text colour
explicitly, for the reason true/false's toggle does.

### Review reads the score, because it cannot derive correctness

Every other view derives per-choice correctness itself from the key
(`question-rendering.md`, "The view derives per-choice correctness, and never
gets it handed over"). `NumericView` cannot: correctness here is the tolerance
test, the tolerance is not public, and comparing the student's number to the
key with `===` would mark a response inside a declared tolerance as wrong.

So the check or the x comes from `result.score > 0`.

They also show even when the key is withheld, which is the other departure. On
a choice question, hiding the markers hides real information — which of four
options was right. Here there is one box and a score badge already reading
"Score 1.00"; withholding the check would conceal nothing and just look
inconsistent. The key still controls the one thing it is: whether the expected
value is spelled out.

## Files

| File                                        | What                                                      |
| :------------------------------------------ | :-------------------------------------------------------- |
| `src/mdq/scoring.ts`                        | `NumericAnswer`, `score.numeric`, `answerKey.numeric`      |
| `src/mdq/public.ts`                         | `PublicNumeric`, `publicRepresentation.numeric`, `numericDomain` |
| `src/components/question/NumericView.tsx`   | The SolidJS component                                      |
| `src/components/question/QuestionView.tsx`  | A fifth dispatch arm                                       |
| `src/pages/design/questions.astro`          | Numeric sections; the fallback demo needs a new stub type  |

`src/mdq/question.ts` needs no change: `dispatch` finds the new table entries
by name.

The "not yet implemented" section of the showcase demonstrates the fallback
with a numeric stub, which stops being valid once numeric renders. It becomes
`short-answer`.

## Tests

In `test/mdq-question.spec.ts`:

- Exact equality with no tolerance declared, and the boundary either side of it.
- Absolute tolerance: inside, exactly on the boundary, and outside.
- Relative tolerance read as a fraction — `0.05` means 5% — including a value
  accepted by the relative rule that the absolute rule rejects.
- Both tolerances declared: a response accepted by either one scores 1, per
  mdq.spec's ANY.
- A relative tolerance on an answer of 0 does not produce `NaN` or divide by
  zero.
- A `null` value scores 0.
- `answerKey()` is the declared answer.
- `toPublic()` drops `answer`, `tolerance` and `comment`, and keeps `unit` and
  `decimalPlaces`.
- Domain inference: declared wins; an integral answer and tolerance infer
  `integer`; a non-integral answer, or an integral answer with a non-integral
  absolute tolerance, infers `decimal`; a relative tolerance never moves it
  (mdq.spec: `42 +- 5%` is an integer question).

## Known gaps

- **`fraction` cannot be inferred**, only declared — the schema stores parsed
  numbers, and `-1/3` and `-0.333…` are the same value by then. Upstream would
  have to keep the written form, or the parser has to set `domain` itself.
- **No unit conversion.** mdq.spec permits it; a response of `1kg` to a
  question in `g` is graded as the number 1.
- **Exact matching is exact.** `[numeric]: 0.3` rejects a response computed as
  `0.1 + 0.2`. Per mdq.spec this is the author's job to fix with a tolerance,
  but it will surprise someone.
- **The schema's relative-tolerance docstring divides by `|answer|`,** which is
  undefined for an answer of 0. Implemented as a multiplication instead.
