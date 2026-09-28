# Glossary

Be extremely succint when adding entries to the glossary. If a new term is
defined in a conversation, ask human if it should be added to the glossary.
Add in alphabetical order.

---


## Action

Also: Astro Action
Type: platform 

The typed RPC entry point the web app calls for anything that writes. Actions
validate input with Zod and delegate to a [Service](#service); business rules do
not live here. The browser's counterpart to the [REST API](#rest-api), which
serves the [CLI](#cli).

## Actor

Type: platform

The identity a [Service](#service) call is made on behalf of: either a user,
carrying their username, role and name, or a system sentinel for calls with no
person behind them. Services decide visibility from the actor themselves rather
than trusting callers to filter afterwards.

## Admin

Type: domain

The [Role](#role) that sees and manages everything. Admins invite instructors,
and the first one is created outside the app by a management command or dev seed,
since nothing exists yet to invite them.

## API key

Type: domain

A long-lived bearer token for non-browser clients, of kind `CLI` or `BOT`. Shown
once at creation and stored only as a SHA-256 hash, revocable individually, and
sent as `Authorization: Bearer <key>`. A request authenticated by one acts as
the key's owner.

## Attachment

Type: domain

One use of a [Blob](#blob) by one owner — a [Resource](#resource) or
[Question](#question) — carrying the filename and MIME type that use is served
under, and the [User](#user) charged for the bytes. The owner is polymorphic,
so a new kind of owner needs no change to blob storage. The last attachment
leaving a blob makes it collectable.

## Blob

Also: file, bytes
Type: domain

Anonymous file content, addressed by its lowercase-hex SHA-256 hash of its own
bytes. The hash doubles as the URL token and on-disk directory name.
Content-addressed and deduplicated, so identical uploads share one row; it
carries no filename or MIME type, since those belong to each
[Attachment](#attachment). Served with no authentication check on the
understanding that knowing the hash grants access.

## Classroom invite

Type: domain

A reusable join code for one course, redeemable by anyone holding the link.
The role is fixed to student, and max uses caps enrollment or is unlimited.
Contrast [Personal invite](#personal-invite).

## CLI

Also: `codehood` 
Type: domain

The command-line tool instructors use to author a course locally and push it to
the server. It is the reason course content is a Git repository of plain text
rather than something typed into web forms. Sync is one-way — there is no
`codehood pull`, because the server never modifies content.

## Course

Also: course edition 
Type: domain

One offering of a [Discipline](#discipline) by one instructor in one
[Edition](#edition). Those three fields are its unique key and also its
[Course URL](#course-url). It owns everything that varies between runs:
schedule, exams, enrollments, and passphrases.

## Course URL

Type: platform

The address `/<discipline-slug>/<username>_<edition>`, e.g. `/cs101/ada_2026-1`.
Built from the columns of the course's unique key, so no extra id is stored and
the [CLI](#cli) can construct it offline. There is no `/courses/` prefix, which
is why [Reserved slug](#reserved-slug) exists. Everything about the course hangs
off it: `/exams`, `/resources`, `/schedule`, and for instructors, `/questions`,
`/roster`, and `/manage` — one tab strip on every page. The [REST API](#rest-api)
takes the same address under `/api/course/`, so the CLI builds one string for
both.

## Course-scoped endpoint

Type: platform

A [REST API](#rest-api) endpoint nested under a course's
[Course URL](#course-url), e.g. `/api/course/cs101/ada_2026-1/resource/syllabus`.
The path names the course, so the body and query never carry it. A course the
actor may not see returns 403, including in list operations.

## Discipline

Also: subject 
Type: domain

The stable subject a course teaches, identified by a slug such as `cs101`.
A discipline outlives the [Courses](#course) that instantiate it and owns the
[Question](#question) bank shared across them.

## Edition

Type: domain

An academic term, created by an admin, that separates repeated runs of the same
discipline by the same instructor. Its slug is a four-digit year with an optional
term number (e.g., `2026`, `2026-1`) and appears in every course URL, so it
never changes. Its window says when new courses may be created for it; closing
that window leaves existing courses alone.

## Enrollment

Type: domain

A student's membership in a [Course](#course), with an ACTIVE or DROPPED status.
Only active enrollments grant access to course contents.

## Event

Type: domain

One dated occurrence of a [Time slot](#time-slot) — a single class meeting in a
given week, with its own title, description, and kind (lecture, lab, exam,
review, seminar, project, self-study, holiday, recess, or cancelled).
May carry a derived link to an [Exam](#exam) whose window overlaps it. This is
what the calendar renders.

## Exam

Type: domain

A set of [Questions](#question) assigned to a course, of type PRACTICE, QUIZ,
or EXAM. Its status moves DRAFT → SCHEDULED → ONGOING → COMPLETED
(or ARCHIVED), and only ONGOING accepts submissions. Each question is pinned to
a [Question version](#question-version) so the paper does not change while
students are taking it.

## Grading bot

Also: bot 
Type: domain

An automated client that grades submissions through the
[REST API](#rest-api) using an [API key](#api-key). A bot currently acts as the
instructor who issued its key and therefore sees everything that instructor
sees.

## Group

Type: domain

A set of users who share ownership of [Questions](#question), so a teaching team
can maintain a bank together. Membership carries an independent admin flag,
separate from the user's global [Role](#role).

## Instructor

Type: domain

The [Role](#role) that owns courses: authors content locally, pushes it with the
[CLI](#cli), and invites students. An instructor sees only the courses they
teach plus any they are enrolled in.

## Invite

Type: domain

The only way an account comes into existence, since there is no public sign-up.
An invite fixes the [Role](#role) it grants and expires. Redeeming it creates
the [User](#user). Comes in two kinds: [Personal](#personal-invite) and
[Classroom](#classroom-invite).

## Management command

Also: manage
Type: platform

A script for operator tasks that have no UI, such as creating users and
resetting passwords. Commands go through the [Service](#service) layer like
everything else, never straight to the database.

## OpenRPC

Type: platform

The schema specification for JSON-RPC, analogous to OpenAPI for REST.
Generated from the same Zod schemas the [RPC API](#rpc-api) validates against.
Served and rendered through Swagger UI.

## Passphrase

Type: domain

A short expiring secret scoped to one [Course](#course), unique across the
system. Reserved for in-class check-in flows.

## Permission pair

Type: platform

The two encodings every visibility rule needs: a predicate for deciding whether
to show a loaded row or render a button, and a SQL fragment for filtering at
query time rather than in memory. Written adjacent to keep them in sync, since
drifted pairs let the list page and detail page disagree about a row.

## Personal invite

Type: domain

A single-use invite addressed to one email, which the invitee must match exactly.
Used from instructor to student or admin to instructor. Contrast
[Classroom invite](#classroom-invite).

## Practice session

Type: domain

One attempt at a [Practice](#exam)-type [Exam](#exam). A student may take as
many as they like, so each gets its own [Response](#response), told apart by
the session's start time. A graded exam has no practice session and exactly one
response.

## Public id

Type: platform

A random ten-character URL-safe string on rows whose identifier appears in a URL
but should not be guessable. Primary keys stay auto-incrementing integers,
while the public id is generated in the service layer.

## Question

Also: question ref 
Type: domain

The stable identity of a question: its author, discipline, type (multiple-choice,
multiple-selection, true-false, or essay), status (draft, published, or archived),
and tags. The text lives in its [versions](#question-version) instead, so the
reference stays lightweight and editing never rewrites history.

## Question version

Type: domain

One immutable revision of a question's content — title, stem, and a
type-specific JSON payload — identified by a hash. Editing appends a version;
exams and courses may pin an older one.

## Reserved slug

Type: platform

A top-level name a [Discipline](#discipline) may not take, because
[Course URLs](#course-url) live in the root namespace. A discipline named
`login` would conflict with top-level routes and make its courses unreachable.

## Resource

Type: domain

One of the four things a [Course](#course) gives its students — a file to
download, a link to follow, a markdown note, or a code snippet — grouped by
type in a fixed order. Pushed by the [CLI](#cli) only, never authored in the
web app; visible to everyone who may see the course's contents. A file resource
points at a [Blob](#blob) it does not own, through an [Attachment](#attachment)
it does — the same bytes may back resources in more than one course.

## Resource tombstone

Also: blob tombstone
Type: domain

What a [Blob](#blob)'s row becomes once its bytes are removed and no
[Attachment](#attachment) points at it. The row and its hash survive with
a deleted timestamp, so the blob route can answer 410 Gone and explain what
happened instead of 404.

## Response

Type: domain

One student's attempt at one [Exam](#exam). It collects the
[Submissions](#submission) they make for each question in it, and decides
whether more may arrive.

## REST API

Type: platform

The HTTP surface the [CLI](#cli) and [Grading bots](#grading-bot) use,
authenticated by [API key](#api-key) rather than session cookie. Its handlers
are thin wrappers over [Services](#service).

## Rev

Type: platform

Optional revision marker the [CLI](#cli) writes on the entities it syncs
([Course](#course), [Event](#event), [Exam](#exam), [Question](#question),
[Resource](#resource)). Opaque to the server. The CLI compares it with its local
copy to detect changes and conflicts. Not an identifier.

## Role

Type: domain

The account-wide permission level — [Admin](#admin), [Instructor](#instructor),
or [Student](#student) — fixed by the [Invite](#invite) that created the
account. Per-course authority is decided by ownership and [Enrollment](#enrollment).

## RPC API

Also: JSON-RPC 
Type: platform

The [JSON-RPC 2.0](https://www.jsonrpc.org/specification) surface for verb-shaped
operations the [REST API](#rest-api) would have to invent a resource for. Methods
are authenticated the same way as everything else and are thin wrappers over
[Services](#service). Described by [OpenRPC](#openrpc).

## Service

Also: service class, db service 
Type: platform

The layer wrapping the database for one model, exposing CRUD operations and
holding every business rule and access check for it. Services do not leak
database types upward, and every other layer — [Actions](#action),
[REST API](#rest-api), [Management commands](#management-command) — is a thin
wrapper over them. A method that returns different results to different people
takes an [Actor](#actor) and applies the rule itself.

## Session

Type: domain

A browser login, represented by a 256-bit opaque token in an httpOnly cookie and
stored only as a SHA-256 hash. Not a JWT, so it can be revoked by deleting the
row. Expiry slides over 30 days, refreshed after halfway to avoid writing on
every request.

## Spec

Type: process

The document a feature is designed in before it is built, stating requirements
and naming the design decisions taken. Specs move to review when work lands.
Longer-lived conventions live in the README of the directory they govern
instead; bugs go to a separate issues folder.

## Student

Type: domain

The [Role](#role) that consumes a course through the web app: sees courses they
have an active [Enrollment](#enrollment) in and answers questions. The
[CLI](#cli) works for students too, but is not required.

## Submission

Type: domain

One attempt at a single question inside a [Response](#response), carrying the
answer payload plus grade, feedback, and status. Attempts accumulate rather than
overwrite, so a response keeps its full history.

## Time slot

Type: domain

A course's recurring weekly meeting — a weekday and a start and end time. Carries
an authored slug (stable when the hour moves) and an optional title for the
syllabus line. Concrete dated meetings are its [Events](#event).

## User

Type: domain

An account, holding a [Role](#role), a unique username, and external handles
(github id, school id) collected at invite acceptance. The username is immutable
because it is the foreign key courses reference for the instructor and a path
segment of every [Course URL](#course-url) that instructor owns.
