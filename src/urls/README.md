# URL structure

How the Codehood server lays out its URLs, and the rules a new route has to
respect. Read it before adding any top-level route: the root namespace is
shared with course content and collisions fail silently.

The grammar itself is not repeated here. `src/urls/constants.ts` holds the
regexes and the reserved-name set; `src/urls/parsing.ts` holds the parsers.
Those are the source of truth.

## The root namespace belongs to disciplines

A course is addressed as `/<discipline-slug>/<username>_<edition>`:

```
/cs101/ada_2026-1          Ada's 2026 first-term edition of CS 101
/cs101/turing_2026-1       Turing's parallel section, same term
/algorithms/hopper_2027    an edition identified by year alone
```

Those three parts are exactly the columns in `Course`'s unique constraint,
`@@unique([disciplineSlug, instructorId, edition])`, forming a natural key
relationship. It also means the CLI can build a course URL from local
configuration without asking the server for an id first. `

The discipline slugs compete with every system route for the same first path
segment, hence we reserve certain top-level names. See "Reserved top-level
names" below.

### Parsing the course segment

The course segment splits at its **last** underscore. Editions cannot contain
one, so the tail is always the edition and the head is always the username —
including for the usernames that contain an underscore themselves.

A malformed segment is a 404, not a 400. A well-formed segment naming no
course is also a 404. A course that exists but that you neither take nor teach
is a 403, and the page says so. Course existence is not a secret in an LMS, and
telling a student "you are not enrolled in this course" is more use to them
than pretending the page was never there.

### Sub-routes

Everything belonging to a course hangs off its address:

| Path                                                | Who sees it |
| :-------------------------------------------------- | :---------- |
| `/<course>`                                         | everyone    |
| `/<course>/exams`, `/<course>/exams/<slug>`         | everyone    |
| `/<course>/resources`, `/<course>/resources/<slug>` | everyone    |
| `/<course>/schedule`                                | everyone    |
| `/<course>/questions`, `/<course>/questions/<slug>` | instructor  |
| `/<course>/roster`                                  | instructor  |
| `/<course>/manage`                                  | instructor  |
| `/<course>/gradebook`                               | instructor  |

Every one of these renders the same tab strip (`CourseHeader.astro`,
`courseTabs()` in `src/utils/course-tabs.ts`); which tabs show up is a function
of the course and the viewer, not of which URL they typed. A student never sees
the instructor tabs and gets a 403 if they follow the link anyway (FR-CRS-033).
The gradebook is reached from an exam on the Exams tab rather than through its
own tab; it keeps its URL but carries no entry in the strip.

Instructor-only pages live under the course rather than in a separate
`/teaching/` tree. Two reasons. Every course link works the same way regardless
of who is following it, and an instructor can open the plain course URL to see
what their students see. There is no `/invite` route for issuing one —
generating a classroom join code lives on the Manage tab.

`/<discipline-slug>` on its own is not routed yet. It is reserved for a future
page listing every edition of a discipline. Do not use it for anything else.

## GrammarThe
- **Discipline slug** — lowercase letters, digits and hyphens. Starts with a
  letter, so a slug can never collide with the numeric error pages; ends with a
  letter or digit, so no trailing hyphen. It must also survive the reserved-name
  check below.
- **Username** — lowercase letters, digits, hyphens and underscores. A username
  is a path segment, so the rule is enforced wherever one enters the system
  (`admin.createUser`, `acceptInvite`), and `userUpdate` does not carry
  `username` at all: an account's name cannot change after it exists.
  `userSchema.username` stays a plain `z.string()` — it is also the `returns:`
  schema on four service methods, and an output validator's job is the shape,
  not re-checking a constraint already enforced on write
  (`src/db/services/README.md`).
- **Edition** — either a four-digit year, or a year and a term number joined by
  a hyphen: `2026`, `2026-1`, `2026-2`, `2026-0`. No leading zero on the term
  number, so `2026-1` and `2026-01` cannot both exist and point at different
  courses.

## Reserved top-level names

`RESERVED_SLUGS` in `src/urls/constants.ts` lists the names a discipline slug
must not equal. It covers the routes that exist today plus a buffer of names we
have not used yet but will not give away.

Astro resolves static routes before dynamic ones. A discipline slugged `design`
would not throw an error or produce a warning. `/design` would keep serving the
design system showcase, and every course under that discipline would become
quietly unreachable. The failure is invisible until a student reports that
their course link opens somebody's color palette.

So the rule runs in both directions. Adding a discipline checks the reserved
list. **Adding a top-level route means adding its name to `RESERVED_SLUGS` in
the same commit**, and checking that no existing discipline already claims it.

## System routes

| Route                    | Auth   | Purpose                                               |
| :----------------------- | :----- | :---------------------------------------------------- |
| `/`                      | public | landing page                                          |
| `/login`                 | public | sign in                                               |
| `/invite/[token]`        | public | redeem an invite, set a password                      |
| `/getting-started`       | public | onboarding notes                                      |
| `/courses`               | user   | every course you take or teach                        |
| `/calendar`              | user   | schedule across all your courses                      |
| `/profile`               | user   | your own account, password, API keys                  |
| `/admin`, `/admin/*`     | admin  | administration                                        |
| `/design`, `/design/*`   | public | design system showcase                                |
| `/api/docs`              | public | REST API reference (Swagger UI)                       |
| `/openapi.json`          | public | the OpenAPI document                                  |
| `/rpc/docs`              | public | RPC API reference                                     |
| `/openrpc.json`          | public | the OpenRPC document                                  |
| `/files/<hash>[/<name>]` | none   | resource blobs — no auth check by design (FR-NFR-030) |
| `/403`, `/404`, `/500`   | public | error pages                                           |

`/courses` keeps its name even though no course URL contains it. It is a
listing page, and it is on the reserved list, so nothing collides.

## API, RPC and actions

REST endpoints for the CLI and grading bots live under `/api/`, authenticated
with `Authorization: Bearer <key>`. The live set of paths is
`src/api/registry/route-patterns.json`, generated from the route registry;
`src/api/README.md` covers how they are declared.

A course is addressed in the API by the same natural key it uses on the web, so
the CLI builds one string and uses it for both. There is no `/api/course/<id>`.
Course-scoped endpoints hang off that address the way the web pages do
(`/api/course/<discipline>/<username>_<edition>/{resource,question,exam}`) and
never take the course in a body or query string. A resource's slug is flat, so
it is always exactly one segment; the CLI normalizes repository paths into that
form. The remaining course-scoped resources — `time-slot`, `calendar-event` and
`passphrase` — still use flat addresses until they are converted. Everything
else under `/api/` is addressed by a single segment carrying its primary key.

The status codes deliberately differ from the web app, which rounds a malformed
course URL down to a 404:

| Case                                | Web  | API  | Exception   |
| :---------------------------------- | :--- | :--- | :---------- |
| Segment does not match the grammar  | 404  | 400  | InvalidData |
| Grammar matches, no such course     | 404  | 404  | NotFound    |
| Course exists, actor may not see it | 403  | 403  | NotAllowed  |

Course-scoped endpoints use the same table for the course part of the address,
lists included: a client that names a course it may not see gets 403, not an
empty array.

A person typing a URL cannot act on a 400. The CLI can: `ada_not-a-year` is
malformed local configuration, and reporting it as "no such course" sends the
user hunting for the wrong problem.

`POST /rpc` carries the JSON-RPC surface for verb-shaped operations REST would
have to invent a resource for. Methods are named `namespace.verb` and live in
`src/rpc/`.

Astro Actions post to `/_actions/<namespace>.<name>` and are called through
`Astro.callAction` or the `actions` client import rather than by URL. Current
namespaces are `auth`, `profile`, `admin` and `course`. The path is Astro's,
not ours, but `_actions` is on the reserved list because it occupies a first
segment.
