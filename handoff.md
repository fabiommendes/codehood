# Handoff — implementing `fill-in`, the last MDQ question type

Rewritten 2026-09-05, after `numeric`, `short-answer` and `essay` landed.
Scope: what the six finished types established, and what `fill-in` needs that
none of them did.

## Where things stand

| Type                 | Model | View | Showcase | Spec                                                 |
| :------------------- | :---- | :--- | :------- | :--------------------------------------------------- |
| `multiple-choice`    | done  | done | done     | `dev/specs/to-review/question-rendering.md`          |
| `multiple-selection` | done  | done | done     | `dev/specs/to-review/question-multiple-selection.md` |
| `true-false`         | done  | done | done     | `dev/specs/to-review/question-true-false.md`         |
| `essay`              | done  | done | done     | `dev/specs/to-review/question-essay.md`              |
| `numeric`            | done  | done | done     | `dev/specs/to-review/question-numeric.md`            |
| `short-answer`       | done  | done | done     | `dev/specs/to-review/question-short-answer.md`       |
| `fill-in`            | —     | —    | —        | —                                                    |

Everything is uncommitted on `main`. `pnpm run lint` and `pnpm test` (298
tests, 94 of them in `test/mdq-question.spec.ts`) both pass as of this writing.

Read `question-short-answer.md` and `question-numeric.md` before starting.
`fill-in` reuses both of those grading models wholesale, and the specs carry
the reasoning that is not repeated here.

## The source of truth is a sibling repository

`/home/chips/git/codehood/mdq.spec/docs/question-types/*.md` is the format
specification: one file per type, plus `generic.md` for the shared fields.
**Read the type's file first, in full, before designing anything.** Every type
so far graded in a way that could not be guessed from the schema:

- multiple choice: per-choice scores, `symmetric` fallback computed so random
  guessing averages zero.
- multiple selection: no per-choice scores; every choice is judged, because an
  unticked box asserts "false".
- true/false: three states per statement, and `all-or-nothing` means "no
  mistakes" rather than "everything answered".
- numeric: binary, with two tolerances that are alternatives rather than
  conditions, and no grading strategy at all.
- short answer: binary too, but *how much of the grading is automatic* varies —
  an absent `reject` list carries an implicit trailing wildcard, and writing
  the list out replaces it.
- essay: not graded by the machine at all.

The spec's worked-example tables are the acceptance criteria. Pin every row.
They also contain occasional transcription slips — see "What is wrong with
fill-in's grading section" below, and the note in `question-rendering.md`.
Follow the stated formula, pin it, and flag the discrepancy rather than
encoding it.

## The schema is now current, and the drift guard is live

`public/mdq.schema.json` used to be a stale bundle. It was refreshed from
`../mdq.spec/schema/mdq.schema.json` during the short-answer work, and two
things follow that did not before:

- **`test/mdq-schemas.spec.ts:401` is a real test now**, not a `test.fail`. Any
  edit to `public/mdq.schema.json` without a `pnpm run question-models` fails
  the suite. That is the point.
- **`biome.json` disables the linter for `src/mdq/schemas-generated.ts`.** The
  generator runs `biome format` and deliberately not `check --write`, so its
  bytes do not depend on which lint rules a Biome version autofixes; without
  the exclusion, the project-wide `biome check --write .` that `CLAUDE.md`
  mandates rewrote the file (`noUselessEscapeInRegex`, `[\w.\-]` → `[\w.-]`)
  and broke the guard. Do not remove that override.

The generator also learned to compile a `oneOf` with an inline (non-`$ref`)
branch, which mdq.spec's `pattern` definition needs. If a future refresh brings
a construct it cannot compile, the error names the keyword and the path.

## The methodology, in order

1. **Read the mdq.spec doc for the type**, then the generated schema in
   `src/mdq/schemas-generated.ts` (never edit it).
2. **Write a spec** in `dev/specs/to-do/question-fill-in.md`. Reference the
   earlier specs for shared decisions rather than restating them; argue only
   what is new. Move it to `dev/specs/to-review/` when the work lands.
3. **Extract the shared pieces first** — see the next section. Doing this
   before writing `FillInView` keeps it from becoming a fourth copy of an input
   box that already exists twice.
4. **Implement the model layer yourself** — `src/mdq/`. It is small, it is
   where the subtle decisions live, and it is what the tests pin.
5. **Write the tests before the UI.** `test/mdq-question.spec.ts`, one
   `describe` block per concern.
6. **Verify against the running app, not against intent.** Every round so far
   has turned up something real; see "What review has caught".
7. Move the spec to `to-review/`, update `CHANGELOG.md`, update this file.

## What to extract before writing anything

`fill-in` is the first type that composes other types. Three inputs already
exist and are currently welded into their views:

### `NumericInput` — out of `NumericView.tsx`

The `<label class="input">` wrapper with the unit suffix, the
`type`/`step`/`inputmode` selection by `domain`, and the raw-text signal with
its controlled-value effect. All of that is blank-agnostic; only the score
badge, stem and feedback around it are not.

Two traps already paid for, both of which must survive the extraction:

- The controlled-value effect **must bail when `props.value === undefined`**.
  An absent value means uncontrolled, and syncing from a `null` that was never
  an answer wipes the box on every keystroke. This shipped broken once.
- Keep the raw text in a signal rather than reformatting from the parsed
  number, or a half-typed `3.` snaps back with the caret in it.

`parseNumericInput` / `formatNumericInput` are already in `src/mdq/numeric.ts`.

### `ShortAnswerTextInput` — out of `ShortAnswerView.tsx`

Thinner: a text input plus the uncontrolled fallback. Worth extracting anyway
so the three blank kinds are rendered by three siblings rather than by two
components and one inline `<input>`.

The `validateShortAnswer` warning is *not* part of it — `FillInShortAnswerBlank`
has no `preAccept`/`preReject` (see below), so the blank has nothing to
validate.

### The choice blank is a `<select>`, and does **not** reuse `MultipleChoiceView`

This is the decision the human called out, and it is the right one. A choice
blank sits *inside a sentence*: `The capital of Brazil is [ Brasília ▾ ].` A
stack of radio cards cannot go there. Render a native `<select>` (daisyUI's
`select` class), sized to its content.

So the split is: **share the model, not the markup.**

- Reuse `resolveChoiceIds` from `src/mdq/choices.ts` — it is already
  type-agnostic and takes `{ id?: string; text: string }[]`.
- Reuse the multiple-choice *scoring*, not the view. `choiceScores` in
  `scoring.ts` is currently typed `(question: schema.MultipleChoice)` but only
  reads `question.choices` and `grading(question)`; widen it to
  `Pick<schema.MultipleChoice, "choices"> & { grading?: GradingStrategy }` and a
  `FillInChoiceBlank` satisfies it unchanged.
- A choice's `text` is Markdown everywhere else, and `<option>` renders no
  markup. Decide explicitly: strip to plain text, or forbid markup in a choice
  blank and say so. Do not silently render `` `O(n)` `` with the backticks
  showing.

### Widen, do not duplicate, in the model layer

Three private or narrowly-typed helpers need to accept a blank as well as a
whole question:

| Helper                 | Where                  | Change                                                          |
| :--------------------- | :--------------------- | :-------------------------------------------------------------- |
| `withinTolerance`      | `scoring.ts` (private) | Export it, or move it to `src/mdq/numeric.ts`; widen to `Pick<Numeric, "answer" \| "tolerance">` |
| `acceptPatterns`       | `short-answer.ts`      | Widen to `Pick<ShortAnswer, "oneOf" \| "regex" \| "accept">`      |
| `choiceScores`         | `scoring.ts`           | Widen as above                                                   |

`numericDomain` in `public.ts` is already shaped to take anything with `domain`,
`answer` and `tolerance`; check rather than assume.

## Parsing the stem

`fill-in` is the only type whose *stem* has a grammar:

```lark
item : inline_md? (ref inline_md?)+
ref  : "[^" SLUG "]"
```

You need a `parseFillInStem(stem): Segment[]` where a segment is either
`{ kind: "markdown"; text }` or `{ kind: "blank"; id }`. Put it in
`src/mdq/fill-in.ts` next to the other per-type helpers, and test it directly —
it is the piece most likely to be subtly wrong and the easiest to pin.

SLUG is `FillInBlankIdSchema`'s pattern:
`/^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/`. Anything between brackets that does
not match is not a ref and stays in the Markdown.

Four things to get right, none of which the grammar states:

1. **A ref in the stem with no matching blank, and a blank with no ref.** The
   schema cannot express the cross-reference, so both are representable and
   both must be handled without throwing mid-render. Suggested: an unmatched
   ref renders as literal text, an unreferenced blank is dropped, and both are
   worth a `comment`-style note in the spec. Whether an unreferenced blank
   still counts toward the score is a grading decision — decide it explicitly.
2. **Markdown cannot span a blank.** Each `markdown` segment is rendered on its
   own with `md.renderInline`, so `**bold [^x] bold**` produces two segments
   with unbalanced `**` and renders wrong. Either declare it unsupported (and
   say so in the spec), or pre-render the whole stem with placeholder tokens
   and split the HTML — which is harder and easier to get wrong. Recommend the
   former; mdq.spec's own grammar puts `inline_md` *between* refs, which reads
   as the same restriction.
3. **`[^foo]` is CommonMark footnote syntax.** `markdown-it` is configured
   without the footnote plugin so nothing collides today, but split the stem
   *before* handing anything to `markdown-it`, never after.
4. **The blanks are inline.** The segments have to flow as text, so the
   rendered markdown fragments need `display: inline` and the inputs
   `align-baseline` — a `<div class="prose">` per fragment will stack them.
   `Markdown.tsx` already has an `inline` prop that emits a `<span>`; use it.

## What is wrong with fill-in's grading section

Read `../mdq.spec/docs/question-types/fill-in.md`, "Grading", with suspicion.
Two problems, both worth raising upstream rather than encoding:

- **It is written for ticked choices.** "Each correct blank *ticked* gives a
  point, and each incorrect blank *ticked* subtracts a point. Unticked blanks
  neither add nor subtract." That is multiple-selection's language, copied. It
  says nothing about how a `numeric` or `short-answer` blank contributes, and
  those blanks have no "unticked" state — they are filled or empty. The obvious
  reading is that an empty blank is the "unticked" one and a filled blank is
  right or wrong, but that is an inference, so state it in the spec as one.
- **The worked-example table contradicts itself.** `[1, 1, _, _]` appears
  twice, with `0.00 / 0.00 / -0.50` on one row and `0.50 / 0.50 / -1.00` on
  the other. At least one is a transcription slip. Pin the formula the prose
  states, pin the rows that are consistent with it, and flag the rest — the
  same treatment `question-rendering.md` gave multiple-choice's table.

Also note the table's caption talks about "marking a choice that has no score
defined in the body", which is multiple-choice's per-choice-score mechanism.
A `FillInChoiceBlank`'s choices are `MultipleChoiceChoiceSchema`, so they *do*
carry optional `score` — which suggests a blank is graded by multiple-choice's
rules and the question's `grading` then combines the blanks. Decide, document,
and pin.

## The model layer

Six files in `src/mdq/`:

- `choices.ts` — `resolveChoiceIds`. Type-agnostic; reuse it.
- `numeric.ts` — `parseNumericInput`, `formatNumericInput`.
- `short-answer.ts` — `parsePattern`, `matchesPattern`, `acceptPatterns`,
  `firstMatch`, `matchedFeedback`, `validateShortAnswer`.
- `scoring.ts` — `Answer<T>`, `AnswerKey<T>`, `QuestionResult<T>`, `Scored`,
  and the `score` / `answerKey` dispatch tables. Add one entry to each.
- `public.ts` — `Public<Q>` plus a `publicRepresentation.<type>` entry.
- `question.ts` — **no change.** `Question#dispatch` finds new table entries by
  camel-cased type name and throws naming the missing function when it cannot.

Rules that held across all six types:

- `Answer<T>` and `AnswerKey<T>` are shaped alike, because review screens
  compare them. For fill-in both will be keyed by blank id; pick one shape and
  use it on both sides. Note that `AnswerKey` already uses `Set` and `Map`
  elsewhere, which do not survive `JSON.stringify` — see "Known gaps".
- The public representation strips anything from which the key can be
  reconstructed. For fill-in that is every blank's `choices[].score`,
  `correct`, `oneOf`, `regex`, `answer` and `tolerance` — but **not** `unit`,
  `domain`, `decimalPlaces` or a choice's `text`, which describe the input.
  Numeric and short-answer both argue this split in their specs.
- Nothing clamps. A negative score survives the question; whether it survives
  into the exam total is the exam's `penalty` policy.
- `Scored.pending` means "no automatic verdict", not "worth zero". Essay and
  short-answer both set it. A fill-in question with one unsettled short-answer
  blank probably makes the whole question pending — decide and argue it.
- Per-choice feedback goes in `Scored.choices` (`ChoiceFeedback[]`, document
  order). For fill-in the natural key is the blank id; check whether that shape
  still fits or needs its own field.

## The view

Copy the prop shape from `NumericView.tsx` — it is the closest sibling:

```ts
export interface FillInViewProps {
  question: PublicFillIn;
  value?: ...;                       // keyed by blank id
  onChange?: (next: ...) => void;
  mode?: QuestionMode;
  result?: QuestionResult<"fill-in">;
}
```

The shared pieces are `icons.tsx`, `scoreDisplay.ts` (`scoreBadge`,
`scoreLabel`, `feedbackVariant`, `PENDING_LABEL`, `pendingBadge`) and
`Markdown.tsx`. Reuse them; extract rather than copy if you need a fourth.

`QuestionView.tsx` is a discriminated union of prop shapes with one
`Extract<...>` alias and cast per arm. TypeScript cannot narrow a union by a
nested discriminant (`props.question.type`), so the cast is unavoidable; the
comment in the file explains it. Adding the last arm follows the existing
shape — and once it is added, **the dispatcher's fallback is unreachable from
the union**. Decide what to do with the "Not yet implemented" showcase section:
delete it, or keep it demonstrating an unknown `type` that no longer
corresponds to a pending type. The `pendingTypes` array becomes empty either
way.

`/design/questions` also has a sticky side nav whose `sectionLinks` array is
declared next to the sections it points at. Add a `fill-in` entry, and give the
section a matching `id` and `scroll-mt-6`.

## Verifying like it matters

`astro check` is broken on this project (TypeScript 7 dropped the API the Astro
language server needs), so `.astro` files are **not** type-checked by
`pnpm exec tsc`. The IDE's diagnostics do catch them — call
`mcp__ide__getDiagnostics` on `src/pages/design/questions.astro` before calling
the task done. It has caught a real error and three Tailwind canonicalization
warnings that no CLI check reported.

For anything visual, drive a real browser. Write a short `.mjs` script **in the
project root** (node resolves `@playwright/test` by walking up from the
script's own directory, so it fails from `/tmp`), run it with `node`, delete it
afterwards. Screenshot, then actually look at the image.

Two measurement habits worth keeping:

- Wait ~500ms after an interaction before reading computed styles — daisyUI
  animates, and a mid-transition read looks like a logic bug.
- To prove a key does not leak, read the `props` attribute of the section's
  `astro-island` elements, not `page.content()`. The whole page contains the
  review cards' keys legitimately, so a document-wide `includes()` is a false
  positive every time.

Run, in this order, before calling it done:

```
pnpm exec biome check --write .   # auto-fix
pnpm run lint                     # must exit 0
pnpm exec tsc --noEmit            # pre-existing branded-id errors in test/*-service.spec.ts are not yours
pnpm test                         # 298 + yours
```

`pnpm test` (not a bare `playwright test`) — the runner resets the SQLite
database first, and running playwright directly twice in a row produces ~50
unique-constraint failures that look alarming and mean nothing.

## What review has caught

Each of these survived a first pass and was found by looking at the running
app. Expect the same class of thing:

- **A controlled-value effect that wiped the box.** `NumericView` synced from
  `props.value ?? null` without checking whether `value` was passed at all, so
  every keystroke in an uncontrolled box was erased. Typing was impossible and
  nothing in lint, `tsc` or the unit tests noticed.
- **`<textarea value={...}>` renders empty from the server.** HTML has no
  `value` attribute for a textarea. The text has to go in as children, with a
  ref effect keeping it in step afterwards.
- **Empty key read as withheld.** Two views used `correct.length > 0` to mean
  "the key is known". An empty key is a real key for the choice types.
  `!== undefined`.
- **Disabled controls lost their colour.** daisyUI dims a disabled control,
  erasing what the student answered — the one thing review mode exists to show.
  Selected states keep their colour explicitly outside `answer` mode. HTML
  inspection cannot catch this; read `getComputedStyle().color` and compare.
- **A blue alert for a wrong answer.** The shared `feedbackVariant` calls a
  score of 0 neutral, which is right for the choice types and wrong for the
  binary ones. Numeric and short-answer pass `success`/`error` explicitly.
- **Unlabelled prose next to labelled prose.** Essay's review screen framed the
  model answer and left the student's answer bare, which is exactly the
  confusion that screen must not create. Both are panelled now.
- **A scrollbar for one stray pixel.** `overflow-x-auto` promotes the other
  axis from `visible` to `auto`; the tab strip's `-mb-px` then made
  `scrollHeight` exceed `clientHeight` by 1.
- **Scrollspy losing the last section.** At the bottom of the document a short
  final section never enters the observer's band, so the highlight sticks one
  above. Needs an explicit at-bottom case.
- Missing spaces where Astro swallows whitespace before a `<code>` on the next
  line — use `{" "}`.

## Two conventions worth keeping

**Tailwind class names must be literal.** Anything built by interpolation
(`` `btn-${tone}` ``) is invisible to the scanner and silently produces no CSS.
The existing views keep lookup tables of written-out strings. (`ui/Badge.tsx`
and `ui/Alert.tsx` predate this and do interpolate; they work because the
variants also appear literally elsewhere. Do not copy them.)

**The showcase shows views, not grading.** `/design/questions` has Answer,
Readonly and Review for each type and nothing else — grading tables were built
and then deliberately removed, because a formula's evidence belongs in a test
where it can fail. Do not add them back.

## Known gaps

- **`grading` is still not in the schema.** mdq.spec gives fill-in (and the
  choice types) a `grading` field — `partial | all-or-nothing | symmetric`,
  default `symmetric` — but `question-base.yaml` upstream does not declare it,
  so the refreshed bundle still has none and every question schema is
  `.strict()`. `scoring.ts` reads it through a narrow cast in `grading()` and
  fixtures that set it cast too (see `statements()` in the test file). Fill-in
  will need the same cast. **Fixing this properly means a change upstream in
  `mdq.spec`, not here.**
- **`FillInShortAnswerBlank` is behind `ShortAnswer`.** The blank carries only
  `oneOf` and `regex` — no `accept`, `reject`, `preAccept`, `preReject`, and no
  per-pattern feedback — while the standalone type now has all of them. A blank
  therefore cannot be `pending`, cannot carry feedback, and cannot pre-validate.
  That may be deliberate (a blank inside a sentence is a smaller thing) or may
  be the same lag the bundle had. Worth asking upstream before designing around
  it.
- **`FillInShortAnswerBlank.regex` says it "takes precedence over `oneOf`"**,
  while the standalone `ShortAnswer.regex` joins the accept list. Two different
  rules for the same field name. Pick one, document which, and flag it.
- **Fill-in's grading table contradicts itself** — see above.
- **Two rows of `multiple-choice.md`'s grading table look like transcription
  slips.** Details in `question-rendering.md`. Worth raising upstream.
- **`numericDomain` can never infer `fraction`.** The schema stores parsed
  numbers, so `-1/3` and `-0.333…` are the same value by the time this code
  runs. A fraction question must declare `domain: "fraction"`. Same limitation
  applies to a numeric blank.
- **No unit conversion.** mdq.spec permits it; a response of `1kg` to a
  question in `g` is graded as the number 1.
- **`AnswerKey` uses `Set` and `Map`,** which do not survive `JSON.stringify`.
  Fine in-process; a problem the day this crosses the API, which is the exam
  slice's to solve. Fill-in's key will make this worse, not better — consider a
  plain object keyed by blank id.
- **`marker` cannot localize the true/false toggle labels.** They are fixed
  "True"/"False" text.
- **Frozen toggles render as outline rather than filled.** Cosmetic.
- **`Numeric.unit`'s pattern is `/^[\w.-_]+$/`**, where `.-_` is a character
  *range*, not three literals. Almost certainly not what upstream meant.
  `FillInNumericBlank.unit` has the corrected `/^[\w.\-]+$/`, so the two
  disagree. Upstream's to fix.
- `dev/specs/to-review/questions.md` says rendering is out of scope because
  "`mdq-js` ships the SolidJS components". That is superseded; the note is in
  `question-rendering.md`'s Scope section.

## Suggested skills

Call these with the Skill tool:

- **`daisyui`** — before writing any markup. daisyUI v5 has idioms that are not
  guessable: the true/false control needed
  `.toggle:indeterminate { grid-template-columns: .5fr 1fr .5fr }`, and the
  unit suffix on a numeric input is `<label class="input">` wrapping the input
  plus a `<span class="label">`, not a sibling element. For fill-in you want
  the `select` component doc.
- **`principle-prove-it-works`** — the review findings above are what it is for.
- **`principle-subtract-before-you-add`** — literally this task: extract the
  two input boxes before writing a third.
- **`typescript-functions`** — matches the style already in `src/mdq/`.
- **`unslop`** — the specs and changelog are written in a particular voice;
  keep it.

## A note on the last session

Three types landed (`essay`, `numeric`, `short-answer`), plus two fixes that
were not asked for and are worth knowing about:

- The tab strip offered a vertical scrollbar for one stray pixel
  (`overflow-x-auto` promoting the other axis). Fixed with `overflow-y-hidden`
  in `ui/Tabs.astro`, verified not to clip the active underline.
- `/design/questions` grew a sticky side nav with an IntersectionObserver
  scrollspy, because the page is now long enough that finding a type was the
  slow part.

Short answer was much larger than the others and needed the schema refresh
first — that decision was put to the human and they chose to refresh. The
generator needed two fixes to compile the result, and one of those exposed the
Biome-versus-generator conflict described above. Budget similar surprises for
fill-in: it is the type that touches everything.
