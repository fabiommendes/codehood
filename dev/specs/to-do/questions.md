# Questions

## Scope

The question model and `QuestionService`: storage, versioning, access control,
and validation through `mdq-js`. Everything the CLI needs on the server side
before `03-content-sync.md`'s protocol can be built on top of it.

Requirements covered: `FR-QST-001` … `FR-QST-021`, `FR-QST-040` …
`FR-QST-042`, and `FR-ACC-040` through the sharing model below.

Deliberately **not** covered, and moved to the backlog: `FR-QST-014` (who sets
the version pin) and `FR-QST-030` … `FR-QST-032` (weights on
`QuestionsForExam`). Both live on the exam side of the join table, both are only
meaningful once an exam can be taken, and the earlier draft of this spec claimed
them without designing them.

Out of scope:

| Not in this spec         | Why                                                           |
| :----------------------- | :------------------------------------------------------------ |
| The sync protocol        | Manifest, plans, and idempotent operations are their own spec |
| Rendering questions      | `mdq-js` ships the SolidJS components; the server sends JSON  |
| Grading                  | `06-grading.md`; needs submissions, which need exams          |
| Any authoring UI         | The web app never writes content (`FR-ACC-010`)               |
| Weights and version pins | Backlogged; they belong to the exam slice                     |

## Design decisions

### A question belongs to one course

`QuestionRef.disciplineSlug` becomes `courseId`, and the unique key becomes
`[slug, courseId]`. `QuestionForCourse` is dropped — a question is already in
exactly one course, so the join table has nothing left to say. `authorId` goes
with it: the course names the instructor, and a second owner column could only
ever disagree with it.

The CLI's natural key, `discipline/instructor_edition/question-slug`, then maps
onto exactly one row with no ambiguity, and the edition segment is load-bearing
rather than decorative.

The cost, accepted deliberately: copying a course to a new term produces new
questions with no link back. Editing 2027's copy cannot touch what 2026's
students answered — which is the point — but it also means cross-edition
statistics have nothing to correlate on. That is recorded as an open question in
the requirements, not solved here.

### Content splits into a public half and a private half

`QuestionData.payload` becomes `publicPayload` and `privatePayload`.

Everything a student may see goes in the first: stem, title, options with their
stable ids. Everything they may not goes in the second: the answer key, grading
configuration, solution notes.

Student-facing reads load `publicPayload` alone. There is no serializer that
strips a merged object, because the merge only happens on the server's grading
and validation path, where `mdq-js` gets both halves. A leak would require
actively selecting the private column, rather than forgetting to remove it.

### Options carry stable ids, and the server does not care what they mean

`mdq-js` owns the payload's shape. The one structural thing the server relies on
is that choices are addressable by id rather than by position, because choice
order is shuffled per student (`FR-EXAM-031`) and answers travel as ids. That is
a constraint on the package, written here so it is not discovered during the
exam slice.

### Versions are append-only, and `versionHash` is an opaque label

Writing content creates a `QuestionData` row and repoints `QuestionRef.latest`.
Existing rows are never mutated: an exam may be pinned to any of them.

`versionHash` is whatever the CLI sends. The server does not compute it, does
not parse it, and never infers "unchanged" from an equal hash — it compares
content when it needs to know. `@@unique([refId, versionHash])` stops a buggy
client from mapping one hash to two contents.

### Status is content, not a control

`DRAFT` / `PUBLISHED` / `ARCHIVED` arrive in the push. There is no publish
button, and there never will be while `FR-ACC-010` holds.

Students see `PUBLISHED` questions. The instructor sees all three. `ARCHIVED`
means "offered in nothing new" and never retroactively hides a question from an
exam that already references it, or from a student reading their own answer.

### Writes belong to the instructor, and admins are not an exception

`canManageCourse` currently returns true for admins, which is right for the
course record and wrong for its content. This spec adds the pair:

```ts
// src/auth/permissions.ts, adjacent
export function canWriteCourseContent(actor: Actor, course: CourseWithEnrollment): boolean;
export function canViewQuestion(actor: Actor, question: QuestionWithCourse): boolean;
export function questionVisibility(actor: Actor): Prisma.QuestionRefWhereInput;
export function canShareQuestion(actor: Actor, question: QuestionWithCourse): boolean;
```

`canShareQuestion` is the course's own instructor and nobody else — not an
admin, not a co-instructor, not someone the question was already shared with.
Re-sharing what was shared with you would make the owner's decision
untraceable.

`canWriteCourseContent` is `SYSTEM` or the course's instructor — no admin
branch. The other two are the usual predicate/fragment pair, pinned by an
agreement test.

| Actor             | Sees         | Payload     | Writes |
| :---------------- | :----------- | :---------- | :----- |
| `SYSTEM`          | everything   | both halves | yes    |
| Instructor, owner | all statuses | both halves | yes    |
| Admin             | all statuses | public only | **no** |
| Student, enrolled | `PUBLISHED`  | public only | no     |
| Anyone else       | nothing      | —           | no     |

Admins reading the public half follows from `canViewCourse`, which already lets
them see every course. They have no reason to see an answer key, so they do not.

### Sharing: a question carries a UUID, and its owner may share it

`FR-ACC-040` says a `Group` grants its members read access to the questions
associated with it. That mechanism never got built, and the note under the
requirement says what it is actually for: "so co-teaching instructors can
inspect a shared bank and, in a later milestone, compare a question's
performance across courses."

Sharing does that directly, without a group to administer first.

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
next year's copy, which is exactly the lineage token
`04-questions.md`'s open question asks for. Requiring it *at the moment of
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

### Sharing grants reading, because writing is not the owner's to give

A shared question is readable, in full — both payloads — by any instructor. It
is never writable by anyone but its own course's instructor, and no share can
change that: `FR-ACC-010` makes content writable only by the course's owner, and
`canWriteCourseContent` does not consult `sharedAt`.

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
| Instructor        | read both halves, write via CLI | read both halves | nothing                          |
| Admin             | —                               | read both halves | public half, via `canViewCourse` |
| Student, enrolled | `PUBLISHED`, public half        | no               | nothing                          |

Sharing is server-side state, not content. It is not in the pushed file, a
re-push never clears it, and it does not enter `versionHash` — the same line
`FR-EXAM-002` draws for exam lifecycle, and for the same reason: a flag the
repository could set would be a flag the repository could silently unset.

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
rather than two strangers.

`questions` goes into `RESERVED_SLUGS` **in the same commit** — `FR-CRS-004`,
and the failure mode is silent: a discipline slugged `questions` would not
error, it would just make every course under it unreachable. It goes into
`docs/design/url-structure.md`'s system-route table too.

### `QuestionService` implements the full CRUD set

```ts
type FindOneBy = FillUndefineds<{ id: number } | { publicId: string } | { ref: QuestionRef }>;

interface QuestionRef { courseId: number; slug: string }
interface FindManyBy { courseId?: number; status?: QuestionStatus; type?: QuestionType; tag?: string }
```

`create` and `update` both take `publicPayload`, `privatePayload`, `type`,
`status`, `tags`, and a `versionHash`; `update` appends a version rather than
overwriting one, so the two differ only in whether the `QuestionRef` already
exists. `delete` archives rather than removing, per `FR-SYNC-013`, and writing
to the natural key of an archived question is refused (`FR-SYNC-012`).

Reads are `FindOneAs`/`FindManyAs`: what comes back depends on who asks, so the
actor is required and forgetting it is a compile error.

A separate `findOneForStudent` is *not* added. The same `findOne` returns the
public half unless the actor may see more, because two methods that differ only
in what they omit is exactly the shape where one call site picks the wrong one.

### Validation happens on write, through `mdq-js`

Every write hydrates the merged payload and lets `mdq-js` validate it. A payload
that does not construct is a client error naming what failed, not a stored row
that explodes when a student opens it.

An unknown `QuestionType` is refused the same way (`FR-SYNC-041`): the enum is
the server's declaration of what it supports, and `mdq-js` may be ahead of it.

### Tags stay a join table

`QuestionTags` is `(questionId, tag)` and needs no service of its own —
`create`/`update` replace the set wholesale, which is what a push means.

## Schema

- `QuestionRef`: `disciplineSlug` → `courseId` (relation to `Course`);
  `authorId` dropped; `@@unique([slug, courseId])`; `publicId` gains `@unique`.
- `QuestionData`: `payload` → `publicPayload` + `privatePayload`.
- `QuestionForCourse`: dropped, with its back-relations on `Course` and
  `QuestionRef`.
- `QuestionRef` gains `uuid String?` and `sharedAt DateTime?`, with
  `@@unique([courseId, uuid])`.
- `Group` keeps its relation to `QuestionRef`, now unused: `sharedAt` is what
  grants cross-instructor reads. **`FR-ACC-040` needs amending** — it names
  `Group` as the mechanism, and this spec answers its stated purpose a different
  way. Either the requirement moves to sharing, or `Group` stays as a way to
  share in bulk later; that is a call for the requirements, not for this spec,
  and until it is made `FR-ACC-040` is a `MUST` that nothing satisfies.

The dev database has no question rows, so this is a schema change with no
backfill — the reason to make it before the CLI writes any.

## Tests

Service specs:

- `create` stores the halves separately, and a student-actor read never returns
  `privatePayload` for any status.
- `update` appends a version and repoints `latest`; the previous
  `QuestionData` row is byte-identical afterwards.
- Two questions with the same slug in different courses coexist; the same slug
  twice in one course is rejected.
- `delete` archives, leaves the row readable through an exam that references it,
  and a subsequent write to that natural key is refused.
- A push naming a type outside the enum is refused.
- A payload `mdq-js` rejects is refused, and nothing is written.
- The agreement test: over a fixture set spanning both statuses and both
  courses, `findMany` returns exactly the questions where `canViewQuestion` is
  true, for an instructor, an enrolled student, a non-enrolled student, and an
  admin.
- `canWriteCourseContent` refuses an admin who does not teach the course, which
  is the one row of the table that contradicts `canManageCourse`.

Sharing:

- `share` refuses a question with no `uuid`, and the error names the fix.
- `share` refuses every actor but the course's own instructor — including an
  admin, and including an instructor the question was already shared with.
- A shared question is readable in full by another instructor, and unwritable by
  them: `canWriteCourseContent` still refuses, and `update` throws.
- A shared question is *not* visible to a student in another course, at any
  status. Sharing crosses instructors, never the instructor/student line.
- Unsharing removes it from `/questions/shared` and leaves the row otherwise
  untouched.
- A push that rewrites the question's content leaves `sharedAt` alone — the
  property that makes sharing server-side state rather than content.
- Two rows with the same `uuid` in different courses coexist and group together
  in the shared listing; the same `uuid` twice in one course is rejected.
- A malformed `uuid` is refused at write time, and the server never generates
  one.

No Playwright: nothing renders questions yet. The exam slice brings the browser
tests.

## Documentation to update in the same change

- `src/utils/course-url.ts`: `questions` joins `RESERVED_SLUGS` (`FR-CRS-004`).
- `docs/design/url-structure.md`: `/questions` and `/questions/shared` join the
  system-route table.
- `GLOSSARY.md`: a `Shared question` entry, and `Question` gains its `uuid`.
- `dev/requirements/04-questions.md`: the schema impact gains `uuid` and
  `sharedAt`; the cross-edition open question is answered by `uuid` existing.
- `dev/requirements/01-accounts-access.md`: `FR-ACC-040` needs the amendment
  described in Schema above.

## Follow-up, not in this spec

- **Cross-edition statistics.** `uuid` is the correlation key they needed, and
  it now exists; what to compute with it does not.
- **Bulk sharing**, if per-question sharing turns out to be tedious for a
  teaching team — the `Group` relation is still there for it.
- **Weights and version pins** (`FR-QST-014`, `FR-QST-030` … `FR-QST-032`), on
  the backlog, landing with the exam slice.
- Whether authorship becomes a server-side field or stays in the content.
