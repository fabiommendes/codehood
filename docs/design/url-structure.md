# URL structure

URL layout for the Codehood server. Read it before adding any top-level route,
because the root namespace is shared with course content and collisions fail
silently.

## The root namespace belongs to disciplines

A course is addressed as:

```
/<discipline-slug>/<username>_<edition>
```

```
/cs101/ada_2026-1          Ada's 2026 first-term edition of CS 101
/cs101/turing_2026-1       Turing's parallel section, same term
/algorithms/hopper_2027    an edition identified by year alone
```

There is no `/courses/` prefix on a course URL. The address you see is the one
you type.

Those three parts are exactly the columns in `Course`'s unique constraint,
`@@unique([disciplineSlug, instructorId, edition])`, so the URL identifies one
row with no extra column to store, generate, or keep in sync. It also means the
CLI can build a course URL from local configuration without asking the server
for an id first.

The cost is that discipline slugs compete with every system route for the same
first path segment. See the reserved names section below.

### Sub-routes

Everything belonging to a course hangs off its address:

```
/cs101/ada_2026-1                    course home
/cs101/ada_2026-1/exams              exam index
/cs101/ada_2026-1/exams/<slug>       one exam
/cs101/ada_2026-1/resources          files, links, notes, and snippets, grouped by type
/cs101/ada_2026-1/resources/<slug>   one note or snippet's own page (MD, CODE)
/cs101/ada_2026-1/schedule           the course's own term calendar
/cs101/ada_2026-1/roster             enrolled students ("Students" tab)
/cs101/ada_2026-1/manage             course record, enrollment, sync status
```

Every one of these renders the same tab strip (`CourseHeader.astro`,
`courseTabs()` in `src/utils/course-tabs.ts`); which tabs show up is a
function of the course and the viewer, not of which URL they typed. The last
two are instructor-only — a student never sees their tabs and gets a 403 if
they follow the link anyway (FR-CRS-033). The gradebook is reached from an
exam on the Exams tab rather than through its own tab; it keeps its URL
(`/gradebook`) but carries no separate entry in the strip.

Instructor-only pages live under the course rather than in a separate
`/teaching/` tree. Two reasons. Every course link works the same way regardless
of who is following it, and an instructor can open the plain course URL to see
what their students see. There is no `/invite` route — generating a classroom
join code lives on the Manage tab.

`/<discipline-slug>` on its own is not routed yet. It is reserved for a future
page listing every edition of a discipline. Do not use it for anything else.

## Grammar

### Discipline slug

```
^[a-z][a-z0-9-]{1,30}[a-z0-9]$
```

Lowercase letters, digits, and hyphens. Starts with a letter, so a slug can
never collide with the numeric error pages. Ends with a letter or digit, so no
trailing hyphen. Three to thirty-two characters.

It must also survive the reserved-name check described below.

### Username

```
^[a-z0-9][a-z0-9-]{1,30}$
```

Usernames carry no format rules today. `acceptInvite` and `profile.update`
both validate them as `z.string().min(1)`, which permits slashes, spaces, and
anything else. That was harmless while usernames only appeared in the database.
It is not harmless now that a username is a path segment, so this rule has to be
enforced in both places.

Underscore is deliberately excluded. It is the separator inside the course
segment, and keeping it out of usernames means the segment splits at its only
underscore.

### Edition

```
^[0-9]{4}(-([1-9][0-9]*|0))?$
```

Either a four-digit year, or a year and a term number joined by a hyphen.
`2026`, `2026-1`, `2026-2`, `2026-0`. No leading zero on the term number, so
`2026-1` and `2026-01` cannot both exist and point at different courses.

### Parsing the course segment

Split `<username>_<edition>` at the underscore. Since editions cannot contain
underscores, splitting at the last underscore stays correct even if usernames
are ever allowed to contain one.

A malformed segment is a 404, not a 400. A well-formed segment naming no course
is also a 404. A course that exists but that you neither take nor teach is a
403, and the page says so. Course existence is not a secret in an LMS, and
telling a student "you are not enrolled in this course" is more use to them than
pretending the page was never there.

## Reserved top-level names

A discipline slug must not equal any of these:

```
403  404  500  _actions  _astro  _image  admin  api  calendar  courses
design  favicon  files  getting-started  img  invite  login  logo  manifest
profile  sw
```

Plus a buffer of names we have not used yet but will not give away:

```
about  docs  help  logout  me  new  search  settings  signup  static  users
```

The list lives in code, not only here. Put it next to the discipline validator
so creating a discipline named `login` is rejected at the service layer.

### Why this matters more than it looks

Astro resolves static routes before dynamic ones. A discipline slugged `design`
would not throw an error or produce a warning. `/design` would keep serving the
design system showcase, and every course under that discipline would become
quietly unreachable. The failure is invisible until a student reports that
their course link opens somebody's color palette.

So the rule runs in both directions. Adding a discipline checks the reserved
list. Adding a top-level route means adding its name to the reserved list in
the same commit, and checking that no existing discipline already claims it.

## System routes

| Route                  | Auth   | Purpose                              |
| :--------------------- | :----- | :----------------------------------- |
| `/`                    | public | landing page                         |
| `/login`               | public | sign in                              |
| `/invite/[token]`      | public | redeem an invite, set a password     |
| `/getting-started`     | public | onboarding notes                     |
| `/courses`             | user   | every course you take or teach       |
| `/calendar`            | user   | schedule across all your courses     |
| `/profile`             | user   | your own account, password, API keys |
| `/admin`               | admin  | administration                       |
| `/design`, `/design/*` | public | design system showcase               |
| `/api/docs`            | public | REST API reference (Swagger UI)      |
| `/files/<hash>[/<name>]` | none | resource blobs — no auth check by design (FR-NFR-030) |
| `/403`, `/404`, `/500` | public | error pages                          |

`/courses` keeps its name even though no course URL contains it. It is a
listing page, and it is on the reserved list, so nothing collides.

## API and actions

REST endpoints for the CLI and grading bots live under `/api/`, authenticated
with `Authorization: Bearer <key>`.

```
/api/auth/cli-login
/api/health
```

`/api/health` is the one unauthenticated exception — uptime monitors and
orchestration probes hitting it don't have a key, and checking auth first
would make it a check of the auth system rather than the server.

The REST API is documented as OpenAPI at `/openapi.json`, generated from the
same Zod schemas each endpoint validates against, and browsable as Swagger UI
at `/api/docs`. See `docs/design/openapi.md`.

Astro Actions post to `/_actions/<namespace>.<name>` and are called through
`Astro.callAction` or the `actions` client import rather than by URL. Current
namespaces are `auth`, `profile`, `admin`, and `course`. The path is Astro's,
not ours, but `_actions` is on the reserved list because it occupies a first
segment.
