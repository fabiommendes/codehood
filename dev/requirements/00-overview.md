# Requirements — overview

Functional requirements for the Codehood **server**. The CLI and the `mdq-js`
question package are separate projects; this document specifies only what the
server does and the contracts it exposes to them.

Requirements here were decided in conversation and are binding. Where a decision
is genuinely still open, it appears under **Open questions** in the relevant
file rather than being silently guessed at.

## How to read this

Three notations, each for a different job:

- **Numbered requirements** — `FR-<AREA>-<NNN>`, the spine. `MUST`, `SHOULD`,
  and `MAY` carry their RFC 2119 meanings. Ids are stable: never renumber, and
  mark a retired requirement `superseded by FR-…` instead of deleting it.
- **User stories** with Given/When/Then — used only where the experience *is*
  the requirement (taking an exam, joining a course, syncing a repo).
- **Tables** — permission matrices and state machines, where a list of
  sentences would hide the gaps.

Each file ends with **Schema impact** (Prisma changes the requirements imply,
not yet applied) and **Open questions**.

## Actors

| Actor | Reaches the server through | Can write |
| :--- | :--- | :--- |
| Student | Web app | Own responses, drafts, profile, enrollment |
| Instructor | Web app + CLI | Own courses: content via CLI, operations via web |
| Admin | Web app + `manage` | Disciplines, editions, accounts, course archival |
| CLI | REST API, `CLI` API key | Course content, as its owner |
| Grading bot | REST API, `BOT` API key | Grades only |
| `SYSTEM` | In-process | Everything; seeds, `manage`, internal transactions |

`SYSTEM` is not a user. It is the sentinel actor for callers with no person
behind them, and it bypasses the rules below by design — see
`docs/design/service-access-control.md`.

## The shape of the system

Course content is authored locally in a Git repository and pushed to the server
by the CLI over REST. The server never modifies content and never sends it back.
Student-generated data — responses, submissions, drafts, grades, enrollments —
is born on the server and lives only there. The web app is a reader for the
first and the only writer for the second.

That split is the single idea the rest of these documents elaborate.

## In scope for V1

Accounts and invites · disciplines, editions, courses, enrollment · content sync
from the CLI · question storage and versioning · exams with a timed window ·
per-question submissions with drafts · automatic pre-grading and manual override
· a per-course calendar · resource files · English and Portuguese UI.

## Non-goals

Permanent, by design:

- **The web UI never authors content.** No question editor, no exam builder, no
  calendar editor. The repository is the only source.
- **The server never executes student-submitted code.** Code questions are
  graded out-of-process by a bot that owns its own sandbox.
- **The server never merges or resolves content conflicts.** Two instructors
  sharing a bank reconcile in Git, before pushing.

Deferred, may return in a later milestone:

- Proctoring, lockdown, focus tracking, or any integrity signal beyond
  submission timestamps.
- Course-level final grades. The gradebook is a table of per-exam scores.
- Notifications of any kind. Everything is pull-based; invites are copy-a-link.
- Per-student exam timing. `extraTimeMs` is class-wide; reopening a single
  student's response is the per-person lever.
- Per-user locale and per-course time zones. Both are server-wide settings.
- Revocable access to resource files. See `08-nonfunctional.md` for the threat
  model this accepts.

## Files

| File | Covers |
| :--- | :--- |
| `01-accounts-access.md` | Invites, roles, sessions, API keys, what is public |
| `02-courses.md` | Disciplines, editions, courses, enrollment, archival |
| `03-content-sync.md` | The CLI ↔ server contract |
| `04-questions.md` | Question storage, versions, the `mdq-js` boundary |
| `05-exams.md` | Lifecycle, windows, submissions, drafts, taking an exam |
| `06-grading.md` | Pre-grading, overrides, voids, bots, feedback |
| `07-calendar.md` | Time slots and events |
| `08-nonfunctional.md` | Scale, i18n, retention, deployment, security posture |
