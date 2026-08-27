# Non-functional requirements

## Scale

**FR-NFR-001** — The server MUST support courses of up to **250 students**.

**FR-NFR-002** — It MUST tolerate all 250 taking one exam simultaneously, at a
budget of roughly **20 requests per student per hour** — around 5000 requests in
the exam hour, bursty rather than uniform.

**FR-NFR-003** — Draft autosave MUST fit inside that budget. Saving on blur, on
question change, and on a ~60 second idle timer does; a 15-second tick would be
an order of magnitude over it.

**FR-NFR-004** — The `CLOSED` sweep (FR-EXAM-043, FR-GRD-003) MUST run in a
single transaction. At full scale it promotes and grades up to 5000 rows.

> The sweep is the largest write this system performs, and lazy transitions
> (FR-EXAM-010) mean one unlucky request pays its latency. This is accepted for
> a class-sized deployment; if it becomes visible, the fix is to chunk the sweep
> or trigger it from the instructor's page rather than a student's.

**FR-NFR-005** — SQLite serializes writes. Any feature whose write rate scales
with `students × questions × time` MUST be reviewed against FR-NFR-002 before
implementation.

## Deployment

**FR-NFR-010** — The server MUST run as a single instance with a single SQLite
database, behind a reverse proxy that also serves resource blobs.

**FR-NFR-011** — One deployment MUST serve one institution. Multi-tenancy is a
non-goal, which is what makes the global discipline namespace workable.

## Localization and time

**FR-NFR-020** — The time zone MUST be a single server-wide setting. Timestamps
are stored in UTC and rendered in that zone.

**FR-NFR-021** — The UI MUST support English and Brazilian Portuguese, selected
by a server-wide setting. Per-user locale is a non-goal.

**FR-NFR-022** — Localization MUST cover interface strings only. Course content
is whatever language the instructor wrote.

## Resource files and their threat model

**FR-NFR-030** — A resource file MUST be addressed by an unguessable slug hash
and served directly by the reverse proxy, without an authentication check.

**FR-NFR-031** — Access to a resource MUST be understood as **unrevocable**.
Anyone who learns the URL has the file permanently.

This is a deliberate exception to FR-ACC-030, and the consequences belong in the
open:

- A student who shares a link has granted access to everyone they shared it
  with, and to everyone those people share it with.
- Reverse-proxy access logs contain the URLs, so log access is file access.
- A `Referer` header can leak a resource URL to any third-party site a student
  navigates to from a page containing it.
- Removing the blob (FR-SYNC-013) stops future reads, but cannot recall copies.

**FR-NFR-032** — Resources MUST NOT be used for anything whose disclosure
matters: exam papers before the window, answer keys, per-student feedback, or
anything identifying a student. A `private` flag may lift this later.

**FR-NFR-033** — Blobs MUST be linked to their uses through explicit join tables
(`FileForCourse`, `FileForUser`, …) rather than a foreign key on `File`, so one
blob can serve several purposes.

## Retention and privacy

**FR-NFR-040** — Submissions, responses, and grades MUST be retained
indefinitely. There is no purge in V1.

**FR-NFR-041** — Archiving a course MUST NOT delete any student data
(FR-CRS-034).

**FR-NFR-042** — Passwords MUST be hashed with Argon2id; session tokens and API
keys MUST be stored as SHA-256 hashes and never recoverable.

## Open questions

- Is there an obligation to export a student's own data on request, and if so in
  what form?
- What is the backup story for the SQLite file and the blob directory? Nothing
  in these requirements covers loss of the database.
