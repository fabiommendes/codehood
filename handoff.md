# Handoff — the MDQ question types are done

Rewritten 2026-09-05, after `fill-in` landed. All seven types now have a model,
a view and a showcase section.

## Where things stand

| Type                 | Model | View | Showcase | Spec                                                 |
| :------------------- | :---- | :--- | :------- | :--------------------------------------------------- |
| `multiple-choice`    | done  | done | done     | `dev/specs/to-review/question-rendering.md`          |
| `multiple-selection` | done  | done | done     | `dev/specs/to-review/question-multiple-selection.md` |
| `true-false`         | done  | done | done     | `dev/specs/to-review/question-true-false.md`         |
| `essay`              | done  | done | done     | `dev/specs/to-review/question-essay.md`              |
| `numeric`            | done  | done | done     | `dev/specs/to-review/question-numeric.md`            |
| `short-answer`       | done  | done | done     | `dev/specs/to-review/question-short-answer.md`       |
| `fill-in`            | done  | done | done     | `dev/specs/to-review/question-fill-in.md`            |

Everything is uncommitted on `main`. `pnpm run lint`, `pnpm exec tsc --noEmit`
(no `src/` errors; the branded-id errors in `test/*-service.spec.ts` predate
this work) and `pnpm test` (319 tests, 99 of them in
`test/mdq-question.spec.ts`) all pass as of this writing.

The next slice is storage, then the exam — not another question type.

**Questions are not stored anywhere yet.** There is no question service, and
`QuestionType` in `prisma/schema.prisma` still lists only four of the seven
types. `Question#validate()` exists and is tested, and nothing calls it; a
question that fails it must not reach `QuestionData`. That is the storage
slice's first job, along with widening the enum.

What the exam slice inherits is listed under "Known gaps" below.

## What fill-in added, in case it needs revisiting

- `src/mdq/fill-in.ts` — `parseFillInStem`, `fillInBlanks`, `blankPatterns`.
  Deliberately free of any scoring import, so `scoring.ts` can depend on it
  without a cycle.
- `scoring.ts` — `score.fillIn`, `answerKey.fillIn`, the exported `gradeBlank`,
  and `Scored.blanks`, a per-blank score map. `withinTolerance` moved out to
  `numeric.ts` and was widened; `choiceScores` and `answerKey.multipleChoice`
  now take `ChoiceScored`, which a `FillInChoiceBlank` satisfies unchanged.
- `public.ts` — `PublicFillIn` and its three blank shapes; `numericDomain`
  widened to a `Pick`.
- `src/mdq/validation.ts` — `validateQuestion`, reached through
  `Question#validate()`. The first cross-field checks in the project: fill-in is
  the first type whose stem and blanks have to agree, which JSON Schema cannot
  express. **Nothing calls it yet** — see the next section.
- `ChoiceSelect.tsx` — a select-only combobox rendering inline Markdown, since
  a native `<option>` cannot. Carries the listbox keyboard contract; the two
  Biome a11y suppressions in it are the APG pattern, not shortcuts.
- `NumericInput.tsx` and `TextInput.tsx` — extracted out of `NumericView` and
  `ShortAnswerView`, which now compose them. `NumericInput` takes *either* a
  numeric `value` or a raw `text`; fill-in uses the latter, because a blank
  distinguishes an empty box from one holding "about ten" and a parsed `null`
  cannot.

The reasoning is in `dev/specs/to-review/question-fill-in.md`. Three arguments
there are worth knowing before touching this code: why the answer is one string
per blank id, why `Scored` grew `blanks`, and why fill-in's grading table in
mdq.spec is not an acceptance criterion.

## The source of truth is a sibling repository

`/home/chips/git/codehood/mdq.spec/docs/question-types/*.md` is the format
specification: one file per type, plus `generic.md` for the shared fields. Read
the type's file first, in full. Its worked-example tables are the acceptance
criteria, except where they are demonstrably transcribed from another type —
see "Worth raising upstream".

## The schema is current, and the drift guard is live

`public/mdq.schema.json` was refreshed from `../mdq.spec/schema/mdq.schema.json`
during the short-answer work. Two things follow:

- **`test/mdq-schemas.spec.ts:401` is a real test.** Any edit to
  `public/mdq.schema.json` without a `pnpm run question-models` fails the suite.
  That is the point.
- **`biome.json` disables the linter for `src/mdq/schemas-generated.ts`.** The
  generator runs `biome format` and deliberately not `check --write`, so its
  bytes do not depend on which lint rules a Biome version autofixes; without the
  exclusion, the project-wide `biome check --write .` that `CLAUDE.md` mandates
  rewrote the file and broke the guard. Do not remove that override.

## Verifying like it matters

`astro check` is broken on this project (TypeScript 7 dropped the API the Astro
language server needs), so `.astro` files are **not** type-checked by
`pnpm exec tsc`. Call `mcp__ide__getDiagnostics` on
`src/pages/design/questions.astro` before calling a task done.

For anything visual, drive a real browser. Write a short `.mjs` script **in the
project root** (node resolves `@playwright/test` by walking up from the
script's own directory, so it fails from `/tmp`), run it with `node`, delete it
afterwards. Screenshot, then actually look at the image — three of the four
fill-in defects below were invisible to every assertion and obvious in a
screenshot.

Two measurement habits worth keeping:

- Wait ~500ms after an interaction before reading computed styles — daisyUI
  animates, and a mid-transition read looks like a logic bug.
- Assert on the element you mean. A check for "the dangling reference is still
  shown" passed against `innerText()` of the whole section, because the prose
  above the cards also names `[^missing]` — while the sentence itself had
  silently dropped it. Scope every locator to the island under test.

Run, in this order, before calling it done:

```
pnpm exec biome check --write .   # auto-fix
pnpm run lint                     # must exit 0
pnpm exec tsc --noEmit            # pre-existing branded-id errors in test/*-service.spec.ts are not yours
pnpm test                         # 319 and counting
```

`pnpm test` (not a bare `playwright test`) — the runner resets the SQLite
database first, and running playwright directly twice in a row produces ~50
unique-constraint failures that look alarming and mean nothing.

`biome ci` occasionally exits 254 with "Linter process terminated abnormally
(possibly out of memory)". It is flaky, not a finding; run it again.

## What review has caught

Each of these survived a first pass and was found by looking at the running
app. Expect the same class of thing:

- **A dangling reference vanished from the sentence.** `[^missing]` names no
  blank, the view's `Switch` had no arm for it, and the clause rendered as
  "unlike ." — an author's typo silently eating their own text. Needed a
  `fallback` that renders the reference as written. The deeper fix, which the
  human called for, was `Question#validate()`: a document like that is malformed
  and belongs nowhere near the database, so the showcase demonstrates it no
  longer. The view keeps its graceful behaviour as defence in depth — validation
  guards the door, and one malformed blank should still cost one blank rather
  than a whole exam.
- **A `<select>` came back from the server with nothing picked.** A select's
  value is a DOM property, not part of the HTML, so the readonly card showed an
  empty control where the student's answer should be. It needed `selected` on
  each `<option>` as well as `value` on the select — moot now that the choice
  blank is a `ChoiceSelect`, but the same trap waits in any other native select.
- **Markdown in an `<option>` cannot be made to render.** Not a difficulty, an
  impossibility: an option's content model is text, so a `<code>` written into
  one is in the DOM with a computed monospace font and **zero layout boxes**
  (`getClientRects().length === 0`), where the same markup in a `<span>` has
  one. Writing to `innerHTML` is not the blocker. `ChoiceSelect` exists because
  the only way out is to stop using a native select; budget the APG keyboard
  contract when you do.
- **A frozen blank disappeared.** daisyUI fades a disabled control's border to
  nearly the page colour. The standalone views survive that — their box always
  holds text — but an empty blank in a frozen sentence has nothing to carry it,
  and read as a gap. Note that `disabled:border-…` does not reach the numeric
  box: its border lives on the `<label>` wrapping the input, and a label is
  never itself disabled.
- **A controlled-value effect that wiped the box.** `NumericView` synced from
  `props.value ?? null` without checking whether `value` was passed at all, so
  every keystroke in an uncontrolled box was erased. That guard now lives in
  `NumericInput`; do not remove it.
- **`<textarea value={...}>` renders empty from the server.** HTML has no
  `value` attribute for a textarea. The text goes in as children, with a ref
  effect keeping it in step.
- **Empty key read as withheld.** Two views used `correct.length > 0` to mean
  "the key is known". An empty key is a real key for the choice types.
  `!== undefined`.
- **Disabled controls lost their colour.** daisyUI dims a disabled control,
  erasing what the student answered — the one thing review mode exists to show.
  HTML inspection cannot catch this; read `getComputedStyle().color`.
- **A blue alert for a wrong answer.** The shared `feedbackVariant` calls a
  score of 0 neutral, which is right for the choice types and wrong for the
  binary ones. Numeric and short-answer pass `success`/`error` explicitly.
- **A scrollbar for one stray pixel.** `overflow-x-auto` promotes the other
  axis from `visible` to `auto`; the tab strip's `-mb-px` then made
  `scrollHeight` exceed `clientHeight` by 1.
- **Scrollspy losing the last section.** At the bottom of the document a short
  final section never enters the observer's band. Needs an explicit at-bottom
  case.
- Missing spaces where Astro swallows whitespace before a `<code>` on the next
  line — use `{" "}`.

## Two conventions worth keeping

**Tailwind class names must be literal.** Anything built by interpolation
(`` `btn-${tone}` ``) is invisible to the scanner and silently produces no CSS.
Where a class is conditional, both branches are written out
(`` `${unit ? "w-44" : "w-28"}` ``) so the scanner sees each one. (`ui/Badge.tsx`
and `ui/Alert.tsx` predate this and do interpolate; they work because the
variants also appear literally elsewhere. Do not copy them.)

**The showcase shows views, not grading.** `/design/questions` has Answer,
Readonly and Review for each type and nothing else — grading tables were built
and then deliberately removed, because a formula's evidence belongs in a test
where it can fail. Do not add them back.

## Known gaps

The exam slice inherits the first three.

- **`AnswerKey` uses `Set` and `Map`,** which do not survive `JSON.stringify`.
  Fine in-process; a problem the day this crosses the API. Fill-in deliberately
  went the other way — a plain object of strings on both sides — and is the
  shape to copy when the others are converted.
- **`Scored.choices` keys differently per type.** For every type but fill-in the
  `id` is a choice id; for fill-in it is a blank id, because a choice id is not
  unique across blanks. A consumer must know which type it is reading.
- **No unit conversion.** mdq.spec permits it; a response of `1kg` to a question
  in `g` is graded as the number 1. Same for a numeric blank.
- **`grading` is still not in the schema.** mdq.spec gives fill-in and the
  choice types a `grading` field — `partial | all-or-nothing | symmetric`,
  default `symmetric` — but `question-base.yaml` upstream does not declare it,
  so the refreshed bundle has none and every question schema is `.strict()`.
  `scoring.ts` reads it through a narrow cast in `grading()`, and fixtures that
  set one cast too. **Fixing this properly means a change upstream in
  `mdq.spec`, not here.**
- **`numericDomain` can never infer `fraction`.** The schema stores parsed
  numbers, so `-1/3` and `-0.333…` are the same value by the time this code
  runs. A fraction question must declare `domain: "fraction"`.
- **`marker` cannot localize the true/false toggle labels.** Fixed "True" /
  "False" text.
- **Frozen toggles render as outline rather than filled.** Cosmetic.
- `dev/specs/to-review/questions.md` says rendering is out of scope because
  "`mdq-js` ships the SolidJS components". That is superseded; the note is in
  `question-rendering.md`'s Scope section.

## Worth raising upstream

Five findings, none of them encoded here. Each is argued in the spec that found
it.

- **Fill-in's grading table is multiple-choice's table, copied.** Its caption,
  its `Answer Key` column and five of its seven rows are identical to the
  original; it describes one four-choice multiple-choice question, not a
  fill-in question with four blanks. The copy also picked up damage:
  `[1, 1, _, _]` appears twice with different values, and `[1, 0.5, _, _]`
  disagrees with the original. The prose is what was pinned.
- **Fill-in's grading prose is written in multiple-selection's vocabulary**
  ("each correct blank *ticked*"), which no numeric or short-answer blank has.
  Read here as "an empty blank is the unticked one", which is an inference.
- **`FillInShortAnswerBlank` is behind `ShortAnswer`.** The blank carries only
  `oneOf` and `regex` — no `accept`, `reject`, `preAccept`, `preReject`, no
  per-pattern feedback — while the standalone type has all of them. A blank
  therefore can never be `pending`, carry feedback, or pre-validate. Possibly
  deliberate; possibly the same lag the bundle had.
- **`FillInShortAnswerBlank.regex` "takes precedence over `oneOf`"**, while the
  standalone `ShortAnswer.regex` joins the accept list. Two rules for one field
  name. Each field's own docstring is followed where that field is read, which
  is the only defensible reading and clearly not the intended one.
- **`Numeric.unit`'s pattern is `/^[\w.-_]+$/`**, where `.-_` is a character
  *range*, not three literals. `FillInNumericBlank.unit` has the corrected
  `/^[\w.\-]+$/`, so the two disagree.
- **Two rows of `multiple-choice.md`'s own grading table look like
  transcription slips.** Details in `question-rendering.md`.

## Suggested skills

Call these with the Skill tool:

- **`daisyui`** — before writing any markup. daisyUI v5 has idioms that are not
  guessable: the true/false control needed
  `.toggle:indeterminate { grid-template-columns: .5fr 1fr .5fr }`, and the
  unit suffix on a numeric input is `<label class="input">` wrapping the input
  plus a `<span class="label">`, not a sibling element.
- **`principle-prove-it-works`** — the review findings above are what it is for.
- **`principle-subtract-before-you-add`** — extract before you write a third
  copy; that is what `NumericInput` and `TextInput` were.
- **`typescript-functions`** — matches the style already in `src/mdq/`.
- **`unslop`** — the specs and changelog are written in a particular voice;
  keep it.
