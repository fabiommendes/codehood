# Question rendering — fill in the blanks

## Scope

The seventh and last question type: a stem parser in `src/mdq/fill-in.ts`,
`score.fillIn`, `answerKey.fillIn`, a `PublicFillIn` representation, and a
`FillInView` SolidJS component on the `/design/questions` tab. Two inputs are
extracted out of the views that own them today (`NumericInput`, `TextInput`)
so that `FillInView` composes them rather than growing a third copy.

Shared decisions from the earlier specs are not re-argued: the public half as
the only thing a view receives, three view modes, `QuestionResult` carrying the
key separately, `Scored.pending` for a response only a human can settle.

`fill-in` is the first type that composes other types. That is the whole design
problem, and everything below is a consequence of it.

## Share the model, not the markup

Each blank is "graded exactly like a multiple-choice / short-answer / numeric
question" — the generated schema says so in three docstrings — so the grading
of a blank is reused wholesale. The *rendering* is not, and cannot be: a blank
sits inside a sentence.

> The capital of Brazil is [ Brasília ▾ ]. It has about [ 1300000 ] inhabitants.

A stack of radio cards does not go there. A choice blank renders as a native
`<select class="select">`, sized to its content, and `MultipleChoiceView` is
not involved. What is reused is `resolveChoiceIds` and `choiceScores`, both of
which only ever read `choices` and the grading strategy.

`choiceScores` is widened from `schema.MultipleChoice` to
`Pick<MultipleChoice, "choices"> & { grading?: GradingStrategy }`, which a
`FillInChoiceBlank` satisfies unchanged. `withinTolerance` moves out of
`scoring.ts` into `src/mdq/numeric.ts`, is exported, and is widened to
`Pick<Numeric, "answer" | "tolerance">`. `numericDomain` is widened the same
way. Three widenings, no duplication.

`acceptPatterns` is deliberately *not* widened — see "regex takes precedence"
below. The blank does not share short-answer's semantics, only its engine.

### A choice's text is Markdown, and `<option>` renders none

Everywhere else a choice's `text` goes through `md.renderInline`. An `<option>`
element renders no markup at all, so `` `O(n)` `` would show its backticks.

Decision: **a choice blank's text is rendered as plain text, with the Markdown
delimiters left as the author wrote them.** Stripping them would be a lie about
what the document says, and rendering them is impossible. An author who wants
code voice inside a blank has picked the wrong control; this belongs in the
`comment`-level guidance upstream rather than in a silent transformation here.

## Parsing the stem

`fill-in` is the only type whose stem has a grammar:

```lark
item : inline_md? (ref inline_md?)+
ref  : "[^" SLUG "]"
```

`parseFillInStem(stem)` returns a `FillInSegment[]`, each either
`{ kind: "markdown", text }` or `{ kind: "blank", id }`. SLUG is
`FillInBlankIdSchema`'s pattern, `/[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*/`;
anything between brackets that does not match it is not a ref and stays in the
Markdown.

The split happens **before** anything reaches `markdown-it`. `[^foo]` is
CommonMark footnote syntax, and although the project's `markdown-it` is
configured without the footnote plugin, a stem that is split after rendering
would break the day that changes.

Four decisions the grammar does not state:

**A ref with no matching blank renders as literal text.** The schema cannot
express the cross-reference — `blanks` is a list and the stem is a string — so
a document with a typo in one of the two is representable and must not throw in
the middle of rendering an exam. The literal `[^capitl]` in the sentence is the
most legible way to show an author their mistake.

**A blank with no ref is dropped, and is not graded.** It is not rendered, so
the student cannot answer it; counting it would subtract a point for an
authoring error the student cannot see. `fillInBlanks(question)` returns the
blanks the stem actually references, in document order, and grading, the answer
key and the public representation all go through it.

**Markdown cannot span a blank.** Each markdown segment is rendered on its own
with `md.renderInline`, so `**bold [^x] bold**` produces two fragments with
unbalanced `**` in each. This is declared unsupported rather than worked around
with placeholder tokens and HTML splicing. mdq.spec's own grammar puts
`inline_md` *between* refs, which reads as the same restriction.

**The blanks flow as text.** Every markdown fragment renders through
`Markdown`'s `inline` prop, which emits a `<span>`; the inputs are
`inline-flex` and `align-baseline` so a blank sits on the line rather than
starting one.

## The answer, the key, and why both are plain strings

```ts
export type FillInAnswer = { blanks: Record<string, string> };
export type AnswerKey<"fill-in"> = Record<string, string[]>;
```

A blank's answer is the **raw string the control produced**, whatever kind of
blank it is: a choice id for a `<select>`, the typed text for a short answer,
and the typed text for a number. A blank with no entry, or an entry that is
blank after trimming, is unanswered.

Three reasons for one uniform string rather than a per-kind union:

- It is exactly what the DOM hands over. A numeric blank already needs its raw
  text kept rather than a parsed number — `parseNumericInput` exists because a
  half-typed `3.` must not snap back, and because the `fraction` domain cannot
  use a number input at all.
- It survives `JSON.stringify`. Every other type's `AnswerKey` uses `Set` or
  `Map`, which do not, and which the exam slice will have to solve. Fill-in's
  key is the one with the most entries, so it is the wrong place to make that
  worse.
- A union keyed by blank kind would force every consumer to re-discriminate
  against the question, which is the thing the blank id already does.

The key is a `Record<string, string[]>`: per blank, the acceptable spellings.
A choice blank gives the ids of the choices worth the most (a list, because
choices can tie — the same reason `AnswerKey<"multiple-choice">` is a list); a
short-answer blank gives its literal patterns with the delimiters removed, and
drops its regexes, as the standalone type does; a numeric blank gives the
declared answer, spelled with `formatNumericInput`. A blank with nothing
showable gets an empty array, which means "nothing to show", not "nothing is
correct".

Ids rather than text for a choice blank keeps the key aligned with the answer,
which is what a review screen compares. The view already holds the public
choices and maps an id back to its text.

## Grading

### Per blank first

Each blank yields a **score** and a **verdict**:

| Kind          | Score                                | Verdict                                       |
| :------------ | :----------------------------------- | :-------------------------------------------- |
| choice        | `choiceScores(blank)[index]`         | unanswered / right if score > 0 / wrong       |
| numeric       | 1 inside the tolerance, else 0       | unanswered if the box is empty                |
| short answer  | 1 if a pattern matches, else 0       | unanswered if the box is empty                |

An answer naming a choice no blank claims is treated as unanswered rather than
wrong, matching `score.multipleChoice`'s handling of the same stale-client
case. A numeric box holding text that is not a number at all is *answered and
wrong* — the student typed something — which is where this departs from
`score.numeric`, whose `null` covers both the empty box and the unparseable
one. Fill-in can tell them apart because it keeps the raw text.

### Then the strategy combines them

The prose in `../mdq.spec/docs/question-types/fill-in.md` is written in
multiple-selection's vocabulary ("each correct blank *ticked*"), which no
numeric or short-answer blank has. The obvious reading, stated here as the
inference it is: **an empty blank is the unticked one, and a filled blank is
right or wrong.** With `n` the number of referenced blanks:

- **partial** — `Σ max(0, score) / n`. A right blank contributes what it is
  worth, a wrong or empty one nothing.
- **all-or-nothing** — `0` unless every blank is right, in which case
  `Σ score / n`. The prose is explicit that an unanswered blank is a mistake
  here, which is where this differs from true/false's `all-or-nothing`.
- **symmetric** — `Σ contribution / n`, where a right blank contributes its
  score, an empty one contributes 0, and a wrong one contributes its own score
  when that score is negative and −1 otherwise. Default strategy.

The `score < 0 ? score : -1` in the symmetric case is where mdq.spec's "a score
defined in the body overrides the grading strategy" lands: a choice blank whose
author priced a specific wrong answer at −0.25 keeps that price, and everything
else costs the flat point the prose names. Numeric and short-answer blanks are
binary and never declare a score, so they always cost the flat point.

Nothing is clamped. A negative total survives the question; whether it survives
into the exam total is the exam's `penalty` policy.

### The worked-example table is not about fill-in

`fill-in.md`'s grading table is `multiple-choice.md`'s table, copied. Its
caption ("marking a choice that has no score defined in the body"), its
`Answer Key` column ("a list with each choice score"), and five of its seven
rows are identical to the multiple-choice original. It describes one
four-choice multiple-choice question, not a fill-in question with four blanks,
and it cannot be an acceptance criterion for this type.

The copy also picked up damage on the way: `[1, 1, _, _]` appears twice, once
as `0.00 / 0.00 / -0.50` and once as `0.50 / 0.50 / -1.00`, and
`[1, 0.5, _, _]` reads `0.50 / 0.50 / -0.75` where the original reads
`0.00 / 0.00 / -0.75`. At least two rows are wrong under any reading.

The prose is pinned; the table is flagged upstream and not encoded. The same
treatment `question-rendering.md` gave multiple-choice's own table.

### `pending` is never set

`FillInShortAnswerBlank` carries only `oneOf` and `regex` — no `reject`, and so
no implicit trailing wildcard to replace. Every blank therefore settles, and a
fill-in question is never `pending`. This follows from the schema rather than
from a decision, and it changes the day the blank catches up with the
standalone type. Flagged upstream.

### `regex` takes precedence over `oneOf`

The blank's own docstring says so, while the standalone `ShortAnswer.regex`
joins the accept list. Two rules for one field name. The blank's docstring is
followed here, because it is the one that describes this field:
`blankPatterns` returns `[/regex/]` when `regex` is present and `oneOf`
otherwise. This is why `acceptPatterns` is not widened to cover both — sharing
a signature across two different rules is how the wrong one gets used.

Flagged upstream; one of the two should change.

### Feedback is keyed by blank

`Scored.choices` is `ChoiceFeedback[]`, and for every other type its `id` is a
choice id. For fill-in **the id is a blank id**. A blank is what identifies a
spot in the stem, the view renders feedback beside the blank it belongs to, and
a choice id is not unique across blanks anyway — two blanks may both offer a
choice called `yes`.

The feedback comes from the picked choice of a choice blank, whether that
choice was right or wrong, which is what `score.multipleChoice` already does.
Numeric and short-answer blanks carry no feedback in the schema.

## The public representation

`PublicFillIn` keeps the common fields plus `shuffle`, and replaces `blanks`
with a list that strips everything the key can be reconstructed from:

| Kind         | Kept                                  | Stripped                                 |
| :----------- | :------------------------------------ | :--------------------------------------- |
| choice       | `id`, `type`, `choices: {id, text}[]` | `score`, `correct`, `feedback`, `comment` |
| short answer | `id`, `type`                          | `oneOf`, `regex`                          |
| numeric      | `id`, `type`, `unit`, `decimalPlaces`, resolved `domain` | `answer`, `tolerance`  |

`unit`, `domain` and `decimalPlaces` describe the input box rather than the
answer — the argument numeric's own spec makes — and a choice's `text` is the
thing the student reads. `domain` is resolved through `numericDomain` so the
view is handed a concrete one, as `PublicNumeric` already does.

The blanks are the *referenced* ones, in document order: a blank with no ref is
not rendered, so shipping it would leak a control the student never sees.

The `stem` goes over as written, refs and all. It has to: the refs are where
the inputs go.

## The view

`FillInView` takes the shape its siblings take, with the value keyed by blank:

```ts
export interface FillInViewProps {
  question: PublicFillIn;
  value?: Record<string, string>;
  onChange?: (next: Record<string, string>) => void;
  mode?: QuestionMode;
  result?: QuestionResult<"fill-in">;
}
```

`onChange` receives the whole map rather than an `(id, value)` pair, so a
caller holds one piece of state per question rather than one per blank, and the
uncontrolled fallback has one signal.

Correctness per blank cannot be derived from the key, for the same reason
numeric's and short-answer's cannot: a numeric blank's tolerance and a
short-answer blank's regexes are not in the public half. So `Scored` grows one
optional field:

```ts
/** Per-blank scores, keyed by blank id. Only `fill-in` sets it. */
blanks?: Record<string, number>;
```

Without it a fill-in review screen could only badge the whole sentence, which
is the one thing a sentence full of separate answers must not do — a student
who got three of four blanks right needs to see *which* one cost them. Only an
answered blank appears in the map, so an empty blank draws no mark rather than
a cross.

Under the sentence, in `review` mode and only when the key was sent, an
"Expected" list gives each blank's id and its acceptable spellings, with choice
ids mapped back to their text.

### Extracted inputs

`NumericInput` comes out of `NumericView` with the whole numeric box: the
`<label class="input">` wrapper carrying the unit suffix, the `type` / `step` /
`inputmode` selection by domain, the raw-text signal, and the controlled-value
effect. That effect **must** bail when `value === undefined` — an absent value
means uncontrolled, and syncing from a `null` that was never an answer wipes
the box on every keystroke. It shipped that way once.

`TextInput` comes out of `ShortAnswerView`: a text input plus the uncontrolled
fallback. `validateShortAnswer` stays behind in `ShortAnswerView`, because a
blank has no `preAccept` or `preReject` to validate against.

Both take a `class` so the caller sizes them — `w-full max-w-sm` in a
standalone view, `w-32 inline-flex` inside a sentence — and neither knows
anything about scores, stems or feedback.

## The dispatcher's fallback becomes unreachable

With `fill-in` added, `QuestionViewProps` covers every arm of `PublicQuestion`
and the `Switch`'s fallback can no longer be reached from a well-typed caller.

It stays. The types are a compile-time claim and the payload is a runtime fact:
a question stored before a type was added, or a client one version behind, hits
that branch, and a named warning is a better failure than a blank space. The
showcase's "Not yet implemented" section, which existed to demonstrate it,
becomes a demonstration of an *unknown* type instead of a pending one, and
`pendingTypes` goes away.

## Tests

`test/mdq-question.spec.ts`, one `describe` per concern:

- **stem parsing** — refs and text interleaved, a ref at either end, adjacent
  refs, a bracket expression that is not a slug, an empty stem's degenerate
  case, and the CommonMark-footnote collision.
- **cross-references** — an unmatched ref survives as text; an unreferenced
  blank is absent from `toPublic()`, from the key and from the score.
- **per-blank grading** — each kind right, wrong and empty; a stale choice id;
  a numeric blank inside and outside each tolerance; `regex` beating `oneOf`.
- **strategies** — the three formulas over the same set of answers, with a
  per-choice score to pin the override.
- **the key and the public half** — no `answer`, `tolerance`, `oneOf`, `regex`
  or `score` in `toPublic()`; `domain` resolved; the key shaped as promised.
