# Accounts and access

Authentication is built and documented in `dev/specs/to-review/auth.md`; this
file states the requirements it satisfies and the ones added since, rather than
repeating its design.

## Accounts

**FR-ACC-001** — There MUST be no public sign-up. Every account is created by
redeeming an [Invite](../../GLOSSARY.md#invite).

**FR-ACC-002** — The server MUST support two invite kinds: **personal**
(single-use, bound to one email address the invitee must match) and
**classroom** (reusable link, role fixed to `STUDENT`, optional `maxUses`).

**FR-ACC-003** — Redeeming an invite MUST create the `User`, the
`InviteRedemption`, and — when the invite carries a `courseId` — the
`Enrollment`, in one transaction.

**FR-ACC-004** — `username` MUST be immutable after creation. It is a path
segment of every course URL owned by that instructor and the target of
`Course.instructor`.

**FR-ACC-005** — Usernames MUST match `^[a-z0-9][a-z0-9-]{1,30}$`. Underscore is
excluded: it separates username from edition inside a course URL segment.

## Roles

`ADMIN`, `INSTRUCTOR`, `STUDENT`, fixed by the invite that created the account.

**FR-ACC-010** — Course *content* MUST be writable only by the instructor who
owns the course. `POST`, `PUT`, and `PATCH` on questions, exams, calendar
events, and resources MUST be refused for every other caller, **including
admins**.

**FR-ACC-011** — Admins MUST retain authority over records that are not course
content: disciplines, editions, accounts, and course archival.

**FR-ACC-012** — `SYSTEM` MUST bypass FR-ACC-010. Seeds, `manage` commands, and
internal transactions are not REST callers.

> This overrides the visibility table in
> `docs/design/service-access-control.md`, which grants `ADMIN` full management
> of every course. "Manage the course record" and "write the course content" are
> now separate powers, and admins hold only the first.

## Sessions and API keys

**FR-ACC-020** — Browser sessions MUST use an opaque 256-bit token in an
httpOnly cookie, stored as a SHA-256 hash, with a 30-day sliding expiry
refreshed once past halfway.

**FR-ACC-021** — Non-browser clients MUST authenticate with an API key sent as
`Authorization: Bearer <key>`, shown once at creation, stored hashed, and
revocable individually.

**FR-ACC-022** — An API key MUST have a kind, `CLI` or `BOT`, and the kind MUST
narrow what the request may do:

| Key kind | May read | May write |
| :--- | :--- | :--- |
| `CLI` | everything its owner may read | course content owned by its owner |
| `BOT` | responses and submissions in its owner's courses | grades, feedback, grading status |

**FR-ACC-023** — A `BOT` key MUST NOT create or modify questions, exams,
calendar events, resources, courses, or enrollments.

**FR-ACC-024** — A key of either kind acts as its owner and MUST NOT see more
than its owner sees.

## What is reachable without logging in

**FR-ACC-030** — Every page and endpoint MUST require authentication except the
following, which MUST remain public:

| Route | Why |
| :--- | :--- |
| `/` | Landing page |
| `/login` | Sign in |
| `/invite/[token]` | Redeemed by someone who has no account yet |
| `/getting-started` | Onboarding notes |
| `/design/*` | Design showcase; statically cacheable |
| `/403`, `/404`, `/500` | Error pages |
| `/api/health` | Liveness probe |
| API login endpoints | Exchange credentials for an API key |
| Static assets | Favicon, manifest, fonts, images |

**FR-ACC-031** — Resource file URLs are served by the reverse proxy and are NOT
covered by FR-ACC-030. They are unauthenticated capability URLs; see
`08-nonfunctional.md`.

## Groups

**FR-ACC-040** — A `Group` MUST grant its members read access to the questions
associated with it, and MUST NOT grant any write authority.

**FR-ACC-041** — Group membership MUST NOT affect question ownership. A question
has exactly one owner (`ownerId`) and may credit many authors.

> Groups exist so co-teaching instructors can inspect a shared bank and, in a
> later milestone, compare a question's performance across courses.

## Schema impact

- `QuestionRef.authorId` → `ownerId` (rename; the owner is the course's
  instructor). Authorship becomes metadata, not identity.
- API-key middleware must expose `kind` to the authorization layer so
  FR-ACC-022 can be enforced per request rather than per user.

## Open questions

- Is a `BOT` key bound to a single course, or does it read every response across
  all its owner's courses? FR-ACC-022 currently says the latter.
- Do questions need an explicit `authors` list, or is authorship left to the
  content's own front matter and never modelled server-side?
