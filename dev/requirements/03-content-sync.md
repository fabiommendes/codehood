# Content sync — the CLI ↔ server contract

Course content is authored in a Git repository and pushed by the CLI. This file
specifies what the server accepts, refuses, and reports. How the CLI stores
files, parses front matter, or tracks state locally is out of scope.

## The shape of the protocol

**FR-SYNC-001** — There MUST be no monolithic "push" endpoint. The server MUST
expose ordinary resource endpoints and let the CLI drive.

**FR-SYNC-002** — The server MUST expose a **manifest** endpoint per course
listing the content it holds — identifiers and modification markers, no bodies —
so the CLI can diff locally.

**FR-SYNC-003** — Write operations MUST be idempotent. `PUT` and `DELETE` are
naturally so; `PATCH` MUST be specified and implemented idempotently.

**FR-SYNC-004** — The server MUST NOT compute the difference between repository
and database, and MUST NOT infer deletions. The CLI plans; the server executes
what it is told.

**FR-SYNC-005** — A sync MUST NOT be atomic. An interrupted sync leaves a
partial but coherent state, and re-running the plan MUST converge.

> This is a deliberate trade of atomicity for resumability. Blobs travel inline
> (FR-SYNC-020) and a 40 MB slide deck failing at 90% must not roll back the
> thirty questions that already landed.

**FR-SYNC-006** — Concurrent syncs MUST resolve last-write-wins. The server does
not lock, merge, or detect conflicts; one repository owns a course's content and
co-authors reconcile in Git.

### Syncing a course

> As an instructor, I want to push what I changed and nothing else, so a large
> course syncs in seconds and I can see exactly what happened.

**Given** a course whose content the server already holds
**When** the CLI requests the manifest
**Then** it receives every content item with its identifier and modification
marker, and no bodies

**When** the CLI issues the operations in its plan
**Then** each one succeeds, fails, or is reported as partially ignored,
independently of the others
**And** re-issuing an operation that already succeeded changes nothing

## Identity

**FR-SYNC-010** — Content MUST be addressed by a natural key derived from its
path, not by a server id. The CLI never learns internal ids.

**FR-SYNC-011** — Renaming a file MUST be treated as deleting one item and
creating another. The server has no rename operation and no history across
identities.

**FR-SYNC-012** — Writing to the natural key of an archived item MUST be
rejected by default.

> The consequence of FR-SYNC-011 is that renaming a question that already has
> responses orphans them onto the archived original. That cost was accepted in
> exchange for the server never having to parse or track files.

## Deletion semantics

**FR-SYNC-013** — Deleting content MUST behave per type:

| Type           | On delete                                                 |
| :------------- | :-------------------------------------------------------- |
| Question       | `ARCHIVED`; never removed, because responses reference it |
| Exam           | `ARCHIVED`                                                |
| Calendar event | Deleted outright                                          |
| Resource file  | Blob deleted; URL retained as a tombstone                 |

**FR-SYNC-014** — Archived content MUST continue to resolve everywhere it is
already referenced. A completed exam MUST still render its archived questions,
and a student MUST still be able to read their own answers to them.

**FR-SYNC-015** — A resource tombstone MUST respond with an explanatory error
rather than a bare 404 page.

## Resources

**FR-SYNC-020** — Resource bodies MUST travel base64-encoded inside the JSON
payload. Multipart upload MAY replace this if throughput proves inadequate.

**FR-SYNC-021** — The server MUST NOT parse, transform, or render resource
content. It stores bytes and a MIME type.

## Writing to a live exam

**FR-SYNC-030** — The server MUST reject any content operation against an exam
that is `ONGOING` unless the change is **grade-neutral**.

**FR-SYNC-031** — Grade-neutrality MUST be determined by `mdq-js`. The server
MUST NOT implement its own judgement of which payload edits are safe.

**FR-SYNC-032** — Regardless of grade-neutrality, an operation against an
`ONGOING` exam MUST NOT delete or archive a question, add or remove a question
from the exam, or change a weight.

**FR-SYNC-033** — Schedule fields (`scheduledAt`, `durationMs`) MUST be frozen
once an exam is `ONGOING`, `CLOSED`, or `COMPLETED`.

**FR-SYNC-034** — A write touching a frozen field MUST NOT fail. The server MUST
apply the rest of the operation and report the ignored fields in the response.

> Freezing has to warn rather than reject. After a "start now" override the
> repository disagrees with the database permanently, and a rejecting server
> would make that course unpushable forever.

**FR-SYNC-035** — When a grade-neutral change is accepted for a question in an
`ONGOING` exam, the exam's pinned version MUST advance to the new version.

> The pin exists to protect grading. A change that cannot affect grading is
> exactly the change that may cross it — otherwise the typo fix never reaches
> the students staring at it, and FR-SYNC-030 buys nothing.

## Authority

**FR-SYNC-040** — Content operations MUST require a `CLI` key or a session
belonging to the course's instructor. Admins and `BOT` keys MUST be refused
(FR-ACC-010, FR-ACC-023).

**FR-SYNC-041** — An operation naming a question type the server does not
implement MUST be refused with a client error, not a crash.

## Schema impact

- Content endpoints must resolve natural keys to rows, so lookups by
  `(discipline, instructor, edition, slug)` need to be indexed.
- `File` gains a tombstone marker (`deletedAt`) and a use-linking join table per
  consumer — `FileForCourse`, `FileForUser` (see `08-nonfunctional.md`).

## Open questions

- What is the manifest's modification marker for each type? `versionHash` is
  CLI-supplied and opaque (FR-QST-011), so it works for questions; exams,
  events, and files need something the server can compute.
- Do write operations want `If-Match`/ETag, or is FR-SYNC-006's last-write-wins
  sufficient given one repository per course?
