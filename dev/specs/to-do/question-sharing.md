---
type: spec
status: to-do
tags: [questions, sharing, permissions]
relatedTo: [question-service, urls]
---

# Question sharing and the `/questions` bank

Split out of the questions spec, whose storage, versioning and visibility
parts are implemented. Nothing here exists yet: no `uuid`/`sharedAt` columns,
no share/unshare, no `/questions` pages.

Permissions below use the `hasPerm` registry (`src/auth/permissions/index.ts`):
`course.update-contents` for writes, `question.read` /
`question.read-public` for reads. Sharing adds a branch to `question.read`;
it must not touch `course.update-contents`.

## Design decisions

### Sharing: a question carries a UUID, and its owner may share it

The schema has a `Group` model, meant to give its members read access to the
questions associated with it. That mechanism never got built, and what it was
for is narrower than a group: let co-teaching instructors inspect a shared bank
and, in a later milestone, compare a question's performance across courses.

Sharing does that directly, without a group to administer first. Per-question
`sharedAt` **replaces** `Group`: this spec removes `Group`, `GroupMembership`
and `QuestionRef.groupId` from the schema (see [Schema](#schema)).

```prisma
model QuestionRef {
  /// Authored in the file's front matter. Absent until the author adds one.
  uuid     String?
  /// Set from the web by the owner. Null means private to this course.
  sharedAt DateTime?
  …
  @@unique([courseId, uuid])
}
```

An instructor may share any question **that declares a UUID**, and a question
without one cannot be shared — the service refuses with a message telling the
author to add a `uuid` to the file and push again.

The reason is identity. `(courseId, slug)` addresses a question inside one
course and says nothing across courses, so a shared question referenced from
another instructor's screen has no name that survives the course it came from.
A UUID is authored once, in the file, and travels with the file — including into
next year's copy, which is exactly the lineage token that cross-edition
statistics need to tell "the same question, next term" from a stranger. Requiring it *at the moment of
sharing* rather than always is the cheap version: a question nobody shares never
needs one, and the demand appears at the point where the author gets something
for it.

`uuid` is unique **per course**, not globally. Copying a course into a new
edition copies the file, UUID and all, and both rows are legitimate — they are
the same question in two terms. That is the link the cross-edition statistics
question needs, so this spec creates it and does not use it.

The server validates the shape (RFC 4122) and nothing else. It does not generate
UUIDs: a server-generated one would not be in the file, so the next push would
not carry it back, and the identity would live on exactly one side.

### The `uuid` never leaves the server, except to the question's owner

Hard rule. The `uuid` is the question's identity across courses and editions;
whoever holds it can claim lineage with the question. So no response, page,
API payload, export or error message carries it to anyone but the instructor
of the course that owns the question. That includes:

- another instructor reading a question shared with them;
- an admin;
- a student, at any status, including after grades are released (the answer
  key a student may see is a separate, whitelisted payload, never the raw
  private document).

Consequences:

- The `uuid` is not part of the stored document a non-owner can read. If the
  parser keeps it in the front matter, the write path strips it from the
  stored payloads and keeps it only in the `QuestionRef.uuid` column.
- Every read serializes `uuid` only after an ownership check on that row; the
  `returns:` validator for a non-owner read has no `uuid` field (ADR 0006,
  `dev/adr/0006-validacao-de-entrada-e-saida-nos-services.md`), so a leak fails
  validation instead of reaching the client.
- `/questions/shared` groups rows by `uuid` **on the server**. What reaches the
  page is the groups themselves (lists of rows), with no `uuid` and no value
  derived from it (no hash, no stable group key) that would let two readers
  match a question across courses.

### Sharing grants reading, because writing is not the owner's to give

A shared question is readable in full (both payloads, minus the `uuid`) by any
instructor. It is never writable by anyone but its own course's instructor, and
no share can change that: course content is writable only by the course's
owner, and `course.update-contents` does not consult `sharedAt`.

Both halves, deliberately. An instructor judging whether to reuse a question
needs its answer key and its grading configuration — a question you cannot see
the answer to is not a question you can evaluate. That is the trust the owner
extends when they press Share, and it is per question, which is why the control
is per question and not a course-wide switch.

What the receiving instructor does with it is copy the file into their own
repository and push it to their own course, where they own it. There is no
server-side "add to my course" button: that would be the web app authoring
content, which is a permanent non-goal. Sharing is how a question is *found*;
the CLI is still how it moves.

| Actor             | Own questions                   | Shared by others | Everything else                  |
| :---------------- | :------------------------------ | :--------------- | :------------------------------- |
| Instructor        | read both halves and `uuid`, write via CLI | read both halves, no `uuid` | nothing                          |
| Admin             | -                               | read both halves, no `uuid` | public half, via `course.read-contents` |
| Student, enrolled | `PUBLISHED`, public half        | no               | nothing                          |

Sharing is server-side state, not content. It is not in the pushed file, a
re-push never clears it, and it does not enter `versionHash`. ADR 0011
(`dev/adr/0011-contrato-de-sync-entre-cli-e-servidor.md`) draws the same line
for exam lifecycle, for the same reason: a flag the repository could set would
be a flag the repository could silently unset.

### `/questions`, a new top-level route

Instructors get a question bank of their own, outside any one course, because a
question's useful scope is the instructor and not the course they happened to
put it in.

```
/questions          every question I own, across all my courses
/questions/shared   every question other instructors have shared
```

A sidebar entry, `Questions`, sits under `My courses` and is rendered for
`INSTRUCTOR` and `ADMIN` only — a student has no question-browsing story and
would get an empty page with no way to fill it.

The two pages are tabs on the existing `ui/Tabs.astro` strip in link mode, the
same component `AdminTabs` and the course strip use. On `/questions`: course,
slug, type, status, tags, and a **Share** toggle per row, disabled with a reason
when the question has no `uuid`. On `/questions/shared`: the owner's name and
course alongside, so "who wrote this" is answerable without a lookup, and rows
grouped by `uuid` so the same question across two editions reads as one entry
rather than two strangers. The grouping happens on the server; the `uuid`
itself is not rendered (see the hard rule above).

`questions` goes into `RESERVED_SLUGS` (`src/urls/constants.ts`, the discipline
slugs that system routes take) **in the same commit**. The failure mode is
silent: a discipline slugged `questions` would not
error, it would just make every course under it unreachable. It goes into
`src/urls/README.md`'s system-route table too.

### Listing across courses

`QuestionService.findMany` requires `course` today. The `/questions` page
needs a listing across every course the actor teaches, and the shared tab one
across every shared question. Add those filters rather than looping over
courses.

## Schema

- `QuestionRef` gains `uuid String?` and `sharedAt DateTime?`, with
  `@@unique([courseId, uuid])`.
- `QuestionForCourse` is still in the schema, unused. Drop it with its
  back-relations on `Course` and `QuestionRef` in the same migration.
- `Group`, `GroupMembership`, `User.groupMemberships` and
  `QuestionRef.group`/`groupId` are dropped in the same migration: per-question
  sharing replaces them. Nothing in `src/` uses them today (only commented-out
  lines in `src/db/branding.ts:44-45`, removed too).

## Tests

- `share` refuses a question with no `uuid`, and the error names the fix.
- `share` refuses every actor but the course's own instructor, including an
  admin and an instructor the question was already shared with.
- A shared question is readable in full by another instructor and not
  writable by them: `course.update-contents` still refuses, and `update`
  throws.
- A shared question is not visible to a student in another course, at any
  status.
- Unsharing removes it from `/questions/shared` and leaves the row otherwise
  untouched.
- A push that rewrites the content leaves `sharedAt` alone.
- Two rows with the same `uuid` in different courses coexist and group
  together in the shared listing; the same `uuid` twice in one course is
  rejected.
- A malformed `uuid` is refused at write time, and the server never generates
  one.
- `questions` is a reserved discipline slug.
- The `uuid` reaches only the owner: reading a shared question as another
  instructor, as an admin and as a student returns no `uuid` anywhere in the
  payload (column or front matter), on the web page and on the REST API.
- `/questions/shared` renders two same-`uuid` rows from different courses as one
  group, and the page HTML contains neither `uuid`.
- The non-owner `returns:` validator rejects a payload that carries a `uuid`.

## Acceptance

- An instructor shares a question with a `uuid` from `/questions`, and another
  instructor finds it on `/questions/shared`, reads both halves, and cannot
  write it.
- At no point does a non-owner (instructor, admin, student) receive the
  question's `uuid`, by page, API, export or error message.
- `Group`, `GroupMembership` and `QuestionRef.groupId` are gone from
  `prisma/schema.prisma`.

## Documentation to update in the same change

- `src/urls/constants.ts`: `questions` joins `RESERVED_SLUGS`.
- `src/urls/README.md`: `/questions` and `/questions/shared` join the
  system-route table.
- `GLOSSARY.md`: a `Shared question` entry, and `Question` gains its `uuid`.

## Follow-up, not in this spec

- Cross-edition statistics, keyed on `uuid`.
- Bulk sharing (a course-wide or tag-wide share), if per-question sharing
  proves tedious. Not through `Group`, which this spec removes.
