# Question rendering — short answer

## Scope

The sixth question type: a pattern engine in `src/mdq/short-answer.ts`,
`score.shortAnswer`, `answerKey.shortAnswer`, a `PublicShortAnswer`
representation, and a `ShortAnswerView` SolidJS component on the
`/design/questions` tab.

Shared decisions from the earlier specs are not re-argued: the public half as
the only thing a view receives, three view modes, `QuestionResult` carrying the
key separately, `Scored.pending` for a response only a human can settle.

## The schema was refreshed first

`public/mdq.schema.json` was a stale bundle. Upstream
(`../mdq.spec/schema/mdq.schema.json`) had moved on, and the entire difference
was this question type:

- **added** `accept`, `reject`, `preAccept`, `preReject`, each a `patternList`,
  plus the `pattern` / `patternList` / `patternString` definitions;
- **removed** `exact`, the question-wide boolean — exactness is now per
  pattern, spelled with backticks;
- left `oneOf`, `regex` and `openEnded` alone.

The bundle was copied over and `pnpm run question-models` re-run, which needed
two fixes to the generator:

- `compileOneOf` assumed every branch of a `oneOf` was a `$ref` to a named
  schema. `pattern` has an inline object branch, so branches now compile in
  place, and only an all-named union can still become a
  `z.discriminatedUnion`.
- `buildRootUnionEntry` fed `DefEntry[]` to the reshaped `buildUnionExpr` and
  silently produced `z.union([,])`.

The drift guard in `test/mdq-schemas.spec.ts` was a `test.fail`, parked because
the generated file did not match the bundle. It matches now, so it is a real
test again.

## Design decisions

### Patterns are a mini-language, and the delimiters carry the meaning

A `patternString` says how it wants to be matched:

| Written        | Matched as                                  |
| :------------- | :------------------------------------------ |
| `/…/flags`     | a regular expression                        |
| `` `…` ``      | an exact literal                            |
| `*`            | a wildcard, matching every response         |
| anything else  | a plain literal, compared inexactly         |

`parsePattern` turns a string into one of those four, and `matchesPattern`
applies it. Everything else in this type is built on that pair, which is why
they live in `src/mdq/short-answer.ts` rather than inside the view or the
scorer.

### Three ways to compare, and only one of them is lenient

- **Plain**: NFC, lowercased, runs of whitespace collapsed to one space, ends
  trimmed. It folds spellings no reader can tell apart. It does **not** strip
  diacritics: mdq.spec is explicit that `Brasília` must not accept `Brasilia`,
  because dropping an accent changes how a word is spelled, not how it is
  encoded.
- **Exact**: ends trimmed, NFC, then compared code point for code point. The
  trim is not a weakening — a document has no way to *state* that it wants a
  leading space, so there is nothing there to match against. NFC is the
  `MAY`/`SHOULD` mdq.spec offers, taken because whether an editor emits NFC or
  NFD is not something an author controls.
- **Regex**: matched against the response **raw**. No trim, no case folding, no
  normalization unless the pattern asks with `n`. mdq.spec: *"a regex says
  exactly what it matches, so it gets no implicit leniency"*, and the flags
  exist precisely so the author can ask for some.

### Regex anchoring is implicit, and the wrapper is load-bearing

An mdq regex is anchored at both ends, so `/abc/` is JavaScript's `/^(?:abc)$/`
— the non-capturing group is not decoration, it is what makes `/a|b/` mean
"a or b entire" rather than "starts with a, or ends with b".

The flags that mdq.spec defines for itself are not JavaScript flags and are
handled here:

| Flag | Effect                                                        |
| :--- | :------------------------------------------------------------ |
| `i`  | passed through to JavaScript                                  |
| `n`  | both strings normalized to NFC before matching                |
| `f`  | both implicit anchors dropped — matches anywhere              |
| `b`  | only the trailing anchor dropped — matches any prefix         |

`m g s u v y d` are accepted and ignored, per mdq.spec. An anchor the author
wrote is always honoured: `^(?:^abc)$` and `(?:^abc)` both still match only at
the start, which is why dropping the *implicit* anchors is safe.

An unparseable regex does not throw in the middle of grading an exam. It
matches nothing, and the response falls through to whatever comes next.

### Grading is binary; what varies is how much of it is automatic

mdq.spec: *"The score is always binary … An instructor who wants to award
partial credit has to grade manually."* What varies is how many responses the
question settles by itself, and that maps exactly onto `Scored.pending`, which
essay introduced:

| Response                          | Outcome                        |
| :-------------------------------- | :----------------------------- |
| matches an `accept` pattern       | correct, `score: 1`            |
| else matches a `reject` pattern   | incorrect, `score: 0`          |
| else, and there is no `reject`    | incorrect, `score: 0`          |
| else, and `reject` exists         | `pending` — the instructor's   |
| `openEnded`, or no patterns       | `pending`                      |

The third and fourth rows are the whole subtlety. An absent reject list carries
an implicit trailing wildcard, so nothing falls through; writing the list out
replaces that wildcard with whatever it actually lists, and a response matching
nothing is then not something the question claims to know about. Adding `*`
back as the last item is how an author closes the question off again — and it
needs no special case in the code, since a wildcard matches everything and the
fall-through simply never happens.

Accept wins over reject when both match. That is mdq.spec's rule and it is the
reason the accept list is consulted first rather than both being evaluated and
compared.

### The accept list has three sources, and the frontmatter wins

`accept` is the canonical form of the body's `[short-answer/accept]` block, and
`oneOf` is where a plain `[short-answer]: …` body lands. mdq.spec forbids a
document from using both spellings and says that one which does anyway must
let the frontmatter win — so `accept` replaces `oneOf` when present rather than
joining it.

`regex` is a third spelling of the same thing (mdq.spec: *"or from a body whose
answer text is delimited by `/`"*), so it is always appended to whichever list
won, as one more accept pattern.

### Feedback comes from the list that decided the outcome

The first matching pattern **that carries a message**, from `accept` for a
correct response and `reject` for an incorrect one. First-matching, not
best-matching: mdq.spec makes the order the author wrote significant, and a
pattern that matches but says nothing does not consume the response's chance at
feedback.

A `pending` response gets no feedback: no pattern decided it.

### `preAccept` / `preReject` are public, and are not grading

They are a pre-submission validator — mdq.spec asks that systems *"warn
students about the invalidity of their answer before accepting a
submission"*, which cannot happen if the view is not given them. They reveal a
shape (`must be a number`), not an answer, and they *"play no part in
grading"`: `score.shortAnswer` never looks at them.

`validateShortAnswer` returns the warning, with the precedence inverted from
grading's: a response matching both `preAccept` and `preReject` is invalid.
mdq.spec calls that inversion out explicitly, so it is pinned as a test.

An invalid response is still gradable. The warning is advice, not a gate — the
view shows it and lets the student submit anyway, because nothing in the model
layer treats invalidity as an answer.

### The answer key is the literals, not the rules

`AnswerKey<"short-answer">` is `string[]`: the plain and exact literals from
the accept list, in document order, with their delimiters removed.

Regexes and wildcards are dropped. A review screen puts the key in front of a
student under a heading like "Accepted answers", and `/[Bb]ras[íi]lia/i` is a
grading rule, not an answer anyone can read. A regex-only question therefore
has an empty key, meaning "nothing to show" rather than "nothing is correct" —
the same reading essay's `""` has, and the opposite of multiple selection's
empty `Set`.

### The view

One `<input type="text">`. `readonly` and `review` disable it rather than
replacing it, as numeric does: a single line shows completely when frozen, and
only essay's textarea had a reason to be dropped.

Review reads correctness off `result.score` rather than deriving it, for
numeric's reason and more so: the key it is handed deliberately excludes the
regexes, so it could not reproduce the verdict even in principle. A `pending`
result badges "Awaiting grading" and shows neither a check nor an x.

Answer mode runs `validateShortAnswer` as the student types and shows the
warning inline, without blocking anything.

## Files

| File                                            | What                                                        |
| :---------------------------------------------- | :----------------------------------------------------------- |
| `public/mdq.schema.json`                        | refreshed from mdq.spec                                       |
| `scripts/generate-question-models.ts`           | inline `oneOf` branches; the root union fix                   |
| `src/mdq/short-answer.ts`                       | `parsePattern`, `matchesPattern`, `validateShortAnswer`       |
| `src/mdq/scoring.ts`                            | `ShortAnswerAnswer`, `score.shortAnswer`, `answerKey.shortAnswer` |
| `src/mdq/public.ts`                             | `PublicShortAnswer`, `publicRepresentation.shortAnswer`       |
| `src/components/question/ShortAnswerView.tsx`   | The SolidJS component                                         |
| `src/components/question/QuestionView.tsx`      | A sixth dispatch arm                                          |
| `src/pages/design/questions.astro`              | Short-answer sections; the fallback stub becomes `fill-in`    |

## Tests

In `test/mdq-question.spec.ts`:

- Each delimiter parses to its kind, and `*` to the wildcard.
- Plain matching folds case, NFC and whitespace, and does **not** fold
  diacritics — `Brasilia` is rejected by an inexact `Brasília`.
- Exact matching trims the ends and nothing else: `Math.isnan` and
  `math . isnan` both fail against `` `math.isnan` ``.
- Regex anchoring: `/a|b/` accepts `a` but not `ab`; `^` and `$` written by the
  author are honoured; `f` matches a substring, `b` matches a prefix.
- `i` folds case, `n` folds NFC, and a stale flag such as `g` is ignored rather
  than rejected.
- An unparseable regex matches nothing instead of throwing.
- The four grading outcomes, including the pair that differ only by whether a
  `reject` list exists.
- A `reject` list ending in `*` settles everything, with no special case.
- Accept wins when a response matches both lists, and takes the accept
  feedback.
- Feedback is the first matching pattern *carrying a message*, not the first
  matching pattern.
- `accept` replaces `oneOf`; `regex` joins whichever list won.
- `preReject` beats `preAccept`, the inverse of grading's precedence, and
  neither moves the score.
- `answerKey()` drops regexes and wildcards and strips backticks.
- `toPublic()` drops `oneOf`, `regex`, `accept`, `reject` and `comment`, and
  keeps `preAccept`, `preReject` and `openEnded`.
