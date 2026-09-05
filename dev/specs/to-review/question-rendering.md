# Question rendering — multiple choice (MVP)

## Scope

The first end-to-end slice of a question type: the `src/mdq` public API that
turns a validated `schema.MultipleChoice` into something a student may see and
something a grader may trust, plus the SolidJS component that renders it and a
`/design/questions` tab that showcases every state.

`dev/specs/to-review/questions.md` put rendering out of scope on the grounds
that "`mdq-js` ships the SolidJS components". That is no longer the plan: the
components live here, in `src/components/question/`, and `src/mdq/` is the
model layer they render. This spec supersedes that one line and nothing else.

In scope:

- `Question#score()`, `Question#toPublic()`, `Question#answerKey()`, backed by
  `scoring.ts` and `public.ts`.
- A stable-choice-id rule shared by scoring and the public representation.
- `MultipleChoiceView`, a SolidJS component, in three modes.
- `/design/questions`, a new tab in the design showcase.

Out of scope for the MVP, deliberately:

| Not now                    | Why                                                              |
| :------------------------- | :--------------------------------------------------------------- |
| The other six types        | One type first; the dispatcher and the tab are built to grow     |
| A `grading` field in the JSON schema | Shared with the CLI and the spec repo; flagged, not edited |
| Shuffling choices          | Belongs to the exam slice — it is per student, not per render    |
| Persisting answers         | No submission model exists yet                                   |
| i18n of the fixed strings  | The app has no i18n layer at all yet                             |

## Design decisions

### Choice ids are resolved once, in one place

`MultipleChoiceChoice.id` is optional in the schema, but answers travel as ids
(`questions.md`, "Options carry stable ids"). Scoring and the public
representation therefore need the same fallback, or a student's answer would
address a choice the grader cannot find.

`src/mdq/choices.ts` exports `resolveChoiceIds(choices)`, which resolves the
whole list at once — it has to, because the fallback must not collide with an
id declared further down. mdq.spec (`multiple-choice.md`, "Choices") asks the
derived id to be a slug of the choice text and to stay stable under reordering,
insertion and removal, which a slug is and a position is not. A text that
slugifies to nothing — the spec's own `!` / `?` / `¿` example — or that
collides with an id already in use falls back to its 1-based position.

Both `score.multipleChoice` and `publicRepresentation.multipleChoice` call it,
and the public representation emits ids that are no longer optional: a
component never has to guess.

### Unspecified scores follow mdq.spec's grading strategies

mdq.spec gives multiple choice a `grading` field —
`partial | all-or-nothing | symmetric`, defaulting to `symmetric` — that
decides what a choice declaring no score of its own is worth. `partial` and
`all-or-nothing` both mean zero for this type; they only diverge for multiple
selection.

`symmetric` means the value that makes picking at random average to zero:
with `S` the sum of the declared scores and `u` the number of undeclared
choices, every undeclared choice is worth `clamp(-S / u, -1, 0)`. That
reproduces every row of the spec's table, including the two that clamp.

A choice that declares its own score ignores the strategy entirely, and
nothing is clamped on the way out — the schema is explicit that whether a
negative score survives is the exam's `penalty` policy, never the question's.

**`grading` is not in `public/mdq.schema.json` yet.** The generated
`MultipleChoiceSchema` has no such field, so a question cannot currently carry
one and `strict()` would reject it. `scoring.ts` reads it defensively through a
narrow cast and defaults to `symmetric`; the cast goes away the moment the JSON
schema gains the field and `pnpm run question-models` runs. Adding it to the
JSON schema is deliberately not done here — that file is shared with the CLI
and the spec repository, and is not this change's to edit.

Two rows of the spec's table also look like transcription slips, and are worth
raising upstream rather than encoding: `[1, 1, _, _]` appears twice with two
different answers (−0.50 and −1.00; only −1.00 follows the formula, and −0.50
is what `[1, 0, _, _]` gives), and the `partial` column shows 0.50 for
`[1, 0.5, _, _]` where the stated rule gives 0. The implementation follows the
formula, and `test/mdq-question.spec.ts` pins all seven rows as read that way.

An answer naming a choice that does not exist scores `0` with no feedback. It
is not an error: a stale client or a shuffled-then-edited question can produce
one, and a thrown exception in the grading path is worse than a zero.

### `answerKey()` exists so review mode does not re-derive correctness

Rendering a graded answer needs to mark the right choice, not just the chosen
one. Rather than let each caller decide what "right" means, `scoring.ts` gains
an `answerKey` object beside `score`, and `answerKey.multipleChoice` returns
the ids of every choice whose score is the maximum on offer and above zero.

Maximum-on-offer rather than "score === 1" because a question with a best
choice worth 0.8 is well-formed, and marking nothing correct on it would be a
lie.

### `title` joins the public fields

`CommonPublicFields` omitted it, which cannot be right: the schema describes
`title` as what shows in listings and tables of contents, and a student reading
their own exam sees exactly those. `comment` stays private, `score` and
`feedback` stay private, `answerKey` stays private.

### `toPublicRepresentation` becomes `toPublic`

Nothing calls it yet, and the long name buys nothing at a call site that is
already `question.toPublic()`.

### Markdown is rendered in the component, with raw HTML off

mdq.spec's generic fields make preamble, epilogue and choice text markdown
block (or inline) elements, so a renderer that prints them literally is wrong,
not merely plain. `markdown-it` is already a dependency and runs in both the
server render and the hydrated island, so a single `<Markdown>` component
covers both and the showcase page stays trivial.

`html: false`, the same line `resources.md` draws: question content is authored
by instructors but travels through a sync tool, and a renderer is not the place
to widen what it will execute.

### The answer-shaped types live with the scoring, not with the views

`Answer<T>`, `AnswerKey<T>` and `QuestionResult<T>` are all in `scoring.ts`,
next to the per-type answer shapes they are built from. A view importing
`QuestionResult` from a component barrel would have made the components the
home of a grading concept the server also needs, and `question.ts` re-exports
all three so a caller still has one import site.

`AnswerKey<T>` is shaped like `Answer<T>` rather than like the question,
because a review screen compares the two. Multiple choice is the exception —
a list of ids, not one id, because choices can tie for the best score.

### The component takes the public half, and grading arrives separately

```ts
interface MultipleChoiceViewProps {
  question: PublicMultipleChoice;
  value?: string | null;
  onChange?: (choiceId: string) => void;
  mode?: "answer" | "readonly" | "review";
  result?: QuestionResult;
}

interface QuestionResult {
  score: number;
  feedback?: string;
  /** From `Question#answerKey()`; empty when the key is withheld. */
  correct?: string[];
}
```

The component never receives a `schema.MultipleChoice`. It cannot leak an
answer key it was never given, and the type system says so — the same argument
`questions.md` makes for splitting the payload in the database, applied one
layer up.

`review` is a mode rather than "`result` is present" because a graded answer
whose key is withheld (the exam is still open) is a real state, and it renders
as review with no correctness markers.

### The showcase tab renders the real component

`/design/questions` imports `MultipleChoiceView`, not a copy of it, and drives
it from fixtures built by running a real `Question` through `toPublic()` and
`score()`. A showcase that mocks the thing it documents documents nothing.

It showcases *views*, not grading. Tables of what each strategy scores were
tried and removed: a design page is read to see what a component looks like,
and a formula's evidence belongs in `test/mdq-question.spec.ts`, where it can
fail.

The remaining six types get placeholder cards on the same page, so the tab is
honest about what exists.

## Files

| File                                            | What                                        |
| :---------------------------------------------- | :------------------------------------------ |
| `src/mdq/choices.ts`                            | `resolveChoiceIds`                          |
| `src/mdq/scoring.ts`                            | `score`, `choiceScores`, `answerKey`        |
| `src/mdq/public.ts`                             | `title` in the public fields, resolved ids  |
| `src/mdq/question.ts`                           | `score`, `toPublic`, `answerKey`            |
| `src/components/question/MultipleChoiceView.tsx`| The SolidJS component                       |
| `src/components/question/QuestionView.tsx`      | Type dispatcher                             |
| `src/components/question/types.ts`              | `QuestionMode`                              |
| `src/components/question/Markdown.tsx`          | `markdown-it`, raw HTML off                 |
| `src/pages/design/questions.astro`              | The showcase tab                            |
| `src/layouts/DesignLayout.astro`                | The tab entry                               |

## Tests

`test/mdq-question.spec.ts`:

- A choice with no `id` scores through its derived slug, and `toPublic()`
  emits the same id; a text that slugifies to nothing falls back to position.
- All seven rows of mdq.spec's symmetric-grading table.
- A negative score survives unclamped.
- An unknown choice id scores 0 with no feedback.
- `toPublic()` drops `comment`, and every choice's `score`, `feedback`, and
  `comment`; a deep scan of the serialized output contains none of the private
  strings from the fixture.
- `answerKey()` returns the best choice when the best is 0.8, and returns
  nothing when every choice is worth 0 or less.
- `score()` on a type with no scoring function throws a message naming the
  missing implementation.

No Playwright for the component yet — the design page is the evidence, and
there is no submission flow to drive.
