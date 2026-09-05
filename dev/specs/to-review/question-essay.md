# Question rendering — essay

## Scope

The fourth question type, following `question-rendering.md`,
`question-multiple-selection.md` and `question-true-false.md`: `score.essay`,
`answerKey.essay`, a `PublicEssay` representation, and an `EssayView` SolidJS
component on the `/design/questions` tab.

Shared decisions from those specs are not re-argued: stable ids, the public
half as the only thing a view receives, `markdown-it` with raw HTML off, three
view modes, `QuestionResult` carrying the key separately from the payload.
Choices, per-choice feedback and grading strategies do not apply — essay has no
choices, so `resolveChoiceIds`, `Scored.choices` and `GradingStrategy` are
untouched by this type.

## Design decisions

### The machine cannot grade this, and says so

mdq.spec's "Grading" section for essay is one sentence: *essay questions are
graded manually*. Every other type so far turns an answer into a number;
this one cannot, and the honest response is not to invent one.

`score.essay` returns `{ score: 0, pending: true }`. `pending` is new on
`Scored`:

```ts
/**
 * The score is provisional because nobody has graded it yet.
 */
pending?: boolean;
```

The flag exists because `score: 0` is already a meaningful value — an essay a
human read and marked worthless scores 0 too — and a review screen that shows
"Score 0.00" for an ungraded paper is telling the student they failed. With the
flag, the badge reads "Awaiting grading" and the score is not shown at all.

An instructor's grade is a `QuestionResult` with `pending` absent. Nothing in
the model layer produces one; the grading UI that does is a later slice.

`pending` is optional and unread by the other three views, so it costs them
nothing.

### The answer key is a model answer, and `""` means there is none

`AnswerKey<"essay">` is already declared as `string`, and it is the right
shape: the field mdq.spec puts under `## [answer-key]` is prose, and the review
screen shows it next to the student's prose.

`answerKey.essay` returns `question.answerKey ?? ""`.

The empty-key trap from multiple selection — where an empty `Set` is a real key
and had to be distinguished from a withheld one — does not bite here, and the
generated schema is why: `answerKey` is `.min(1).regex(/\S/)`, so a
well-formed essay question cannot carry a blank model answer. `""` can only
come from the field being absent, which is exactly "this question has no model
answer". Withheld is still `result.correct === undefined`, as everywhere else.

### `input` and `highlight` are public

`PublicEssay` keeps the common fields plus `input` and `highlight`, and strips
`answerKey` and `comment`. The two kept fields describe the *editor*, not the
answer: a student cannot write a code answer without a code box, and
`highlight` names the language for the box. Neither reveals anything about
what a good answer says.

`input` defaults to `"text"` when omitted, per the schema's own documentation.

### Three input kinds, two editors, and no rich-text widget

mdq.spec's `input` distinguishes `code`, `text` and `plain`. What it actually
controls is "should rich text widgets be shown to students or not".

There is no rich text editor in this project, and adding one is not part of
rendering a question type. So:

| `input` | Editor                                         | Display                       |
| :------ | :--------------------------------------------- | :---------------------------- |
| `text`  | `textarea`, labelled as accepting Markdown     | rendered through `<Markdown>` |
| `plain` | `textarea`                                     | `<pre>`, wrapped              |
| `code`  | monospace `textarea`, spellcheck off           | `<pre><code>`, not wrapped    |

`text` is Markdown rather than a WYSIWYG surface because the rest of the format
is Markdown, and because a plain textarea that round-trips exactly what the
student typed is a better base for a future editor than a `contenteditable`
that has to be un-invented later. `highlight` renders as a badge above a `code`
box; syntax colouring inside the editor is a follow-up, not a blocker, and its
absence does not misinform anyone.

### Frozen essays are rendered, not disabled

The other three views freeze by disabling their controls, because for them the
control *is* the display: a disabled toggle still shows which way it points.

A textarea is not. It is an editing affordance with a fixed height and a
scrollbar, and disabling it leaves a long answer hidden behind that scrollbar
with no way to scroll it. So `readonly` and `review` render the submitted text
as content instead of as a frozen input — through `<Markdown>`, `<pre>` or
`<pre><code>` by `input`, per the table above.

This is a deliberate departure from the other three views, and it is what makes
the mode useful: review exists to show what the student wrote, and all of it.

An empty answer renders as a muted "No answer submitted" line rather than an
empty box, since an empty box and a missing box look the same.

### Review shows both texts, and marks neither

There is no per-statement correctness to mark, so `review` mode has no checks,
no crosses and no row tinting. It shows, in order: the badge (a score, or
"Awaiting grading"), the student's answer, the model answer when the key is
released, and the instructor's overall feedback.

Both bodies of prose sit in a labelled bordered block — "Your answer" and
"Model answer" — because they are otherwise the same rendered Markdown stacked
one above the other, and a student reading the model answer as their own is the
one confusion this screen must not create. The student's answer is labelled in
`readonly` mode too, where it is the only thing that could be mistaken for the
question's own preamble.

## Files

| File                                       | What                                                    |
| :----------------------------------------- | :------------------------------------------------------ |
| `src/mdq/scoring.ts`                       | `Scored.pending`, `score.essay`, `answerKey.essay`       |
| `src/mdq/public.ts`                        | `PublicEssay`, `publicRepresentation.essay`              |
| `src/components/question/EssayView.tsx`    | The SolidJS component                                    |
| `src/components/question/scoreDisplay.ts`  | The "Awaiting grading" badge                             |
| `src/components/question/QuestionView.tsx` | A fourth dispatch arm                                    |
| `src/pages/design/questions.astro`         | Essay sections; the fallback demo needs a new stub type  |

`src/mdq/question.ts` needs no change: `dispatch` finds the new table entries
by name.

The "not yet implemented" section of the showcase currently demonstrates the
fallback with an essay stub. Essay stops being a valid demonstration once it
renders, so the stub becomes one of the three types still pending.

## Tests

In `test/mdq-question.spec.ts`:

- `score.essay` scores 0 and flags `pending`, whatever the student wrote,
  including an empty answer.
- `answerKey()` returns the model answer verbatim, and `""` when the question
  declares none.
- `toPublic()` drops `answerKey` and `comment`, and keeps `input` and
  `highlight`.
- `Question#dispatch` reaches essay by name — covered implicitly by the above,
  since all three go through it.
