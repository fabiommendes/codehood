---
type: spec
status: draft
tags: [codehood-server, questions, sync, handoff, api]
relatedTo: [codehood-server, push-questions]
---

# Handoff to the server team: question sync

Three gaps the CLI hit implementing `codehood push` for `questions/`
(see [push-questions.md](../to-review/push-questions.md)). All three are
worked around client-side, so nothing is blocked — this is about removing
the workarounds, not unblocking a feature.

You are an agent working in the Astro/TypeScript server repository. The
CLI is Python; do not assume shared code. Everything below was confirmed
against the dev server at `http://localhost:4321` on 2026-09-20.

## 1. `Question` has no `contentHash` — `medium`

`Resource` addresses content by a free-form `ref`; `CalendarEvent` has a
real `contentHash`. `Question` has neither, only `version: string`
(`minLength: 1`).

The CLI needs *some* server-held digest so a push can skip unchanged
questions without re-uploading the bank on every run. It currently
stuffs `md5:<hex>` of the question file's raw bytes into `version`,
which works because the server stores and returns the string untouched.

That overloads a field whose name promises something else. Two ways out,
either is fine:

- Add `contentHash: string` to `Question`, accepted on create/upsert and
  returned on read and list, with no server-side interpretation — the
  same contract `Resource.ref` already has.
- Or document `version` as opaque-to-the-server and leave it alone, and
  we stop calling this a gap.

Pick one and say which. The CLI does not care about the spelling, only
that it is stable and returned by `listQuestion`.

## 2. The question schema rejects `weight` and `grading` — `low`

`QuestionCreate.question` is `additionalProperties: false`. The `mdq`
package — the format of record for question files, see `../../GLOSSARY.md`
— emits two fields no member of the union allows:

- `weight: number` — the question's share of an exam's score.
- `grading: "symmetric" | ...` — how partial credit is computed.

```
PUT /api/course/cs101/ada_2026-1/question
400 {"code":"invalid-data","message":"question: Unrecognized keys: \"weight\", \"grading\""}
```

The CLI drops both by name before sending. That is lossy: an instructor
who sets a weight in a `.md` file gets it silently ignored server-side.

`weight` arguably belongs on the exam-to-question link rather than the
question, since the same question can carry different weights in
different exams. `grading` is a property of the question itself. Your
call where they land; the CLI will send whatever the schema accepts.

## 3. `DELETE .../question/{slug}` soft-deletes but reads as present — `high`

This is the one worth fixing.

```
DELETE /api/course/cs101/ada_2026-1/question/big-o-warmup
200 {"success": true, "deleted": true}

GET /api/course/cs101/ada_2026-1/question
200 [ ... {"slug": "big-o-warmup", "status": "ARCHIVED", ...} ... ]
```

The row survives with `status: ARCHIVED`, and an unfiltered list still
returns it. The response says `deleted: true`, which is not what
happened.

Soft-delete is a defensible choice — an archived question may still be
referenced by a graded exam. The problem is that the default read
contradicts it. A client that deletes and then lists sees the thing it
just deleted, reported as deleted, and has no way to tell "archived
because I deleted it" from "archived deliberately".

The CLI works around it by listing with
`?statuses=DRAFT&statuses=PUBLISHED`, so an archived question reads as
gone and a second push does not replan its deletion. That workaround is
wrong in one case: a question an instructor archived *on purpose* is
invisible to push, so push re-creates it as `DRAFT` on the next run.

What would fix it, in order of preference:

1. Exclude `ARCHIVED` from `listQuestion` by default, and require an
   explicit `?statuses=ARCHIVED` (or `includeArchived=true`) to see them.
   This matches what `deleted: true` already claims and needs no change
   on our side beyond dropping the filter.
2. Or say `deleted: false, archived: true` in the DELETE response, and
   document that archived rows stay in the default listing. Then the CLI
   filters knowingly rather than by workaround.

Either way, please also answer: is there a way to distinguish
"archived by DELETE" from "archived deliberately"? Push needs it to stop
resurrecting the latter.

## What the CLI does today

For reference, so you can see what changing any of the above would break:

- Slug is the question file's path under `questions/`, flattened:
  `questions/week1/big-o.md` → `week1-big-o`. Driven by your
  `^[a-z0-9][a-z0-9._-]*$` constraint.
- Every pushed question is `status: DRAFT`. The repository has no
  vocabulary for status yet.
- `version` is `md5:<hex>` over the file's bytes.
- `question` is the `mdq` model serialized with camelCase aliases and
  `weight`/`grading` removed.
- One `GET .../question` per push supplies the whole `slug -> version`
  map. A hash-manifest endpoint would replace that one call, but it is
  not needed — the listing is already cheap enough.
