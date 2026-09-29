# Navigation

How people move through Codehood: the regions of the screen, the URL scheme,
and the decisions behind them. Principles referenced as P1, P2, and so on are in
[principles.md](principles.md).


## Screen regions

Signed-in pages use `AppLayout`:

- **Top bar.** Logo (links home, centered over the sidebar column), the
  breadcrumb, the theme toggle, and the user menu: avatar, name and role,
  holding Profile, Set up the CLI and Log out. Below `lg` the bar is
  symmetric: the menu button, the logo in the middle, and the avatar alone; the
  theme switch moves into the user menu.
- **Sidebar.** Global destinations (Home, My courses, Calendar, and Admin for
  admins), then one entry per course the user takes or teaches. The current
  page or course is highlighted. A hand-drawn sketch closes the column; it is
  decoration only (see `docs/ui/identity.md`). It collapses into a drawer
  below the `lg` breakpoint.
- **Content.** The page itself. Course pages start with the course header and
  tab strip; admin pages with the admin header and its tabs.
- **Footer.** One line: logo, a link to the source code, and the version.

Every page puts its content in the same column, `mx-auto max-w-4xl px-4`, so
the left edge is the same on all of them and the breadcrumb lines up with it.
Prose and short forms that need a narrower measure cap an inner element
(`max-w-2xl`, `max-w-md`) inside that column, left-aligned. They never narrow
or widen the column itself.

Pages without a session, or outside the app (login, invite redemption, error
pages), use `CenteredLayout` or `ErrorLayout` and carry no navigation.


## URL scheme

```
/                                   landing page; signed-in users go to /courses
/courses                            my courses
/courses/join                       join a course with a passphrase
/calendar                           my schedule across every course
/profile                            account, password, API keys
/getting-started                    CLI setup
/admin, /admin/*                    admin area (AdminHeader)
/<discipline>/<instructor>_<edition>             course home
/<discipline>/<instructor>_<edition>/<tab>       course tab
/<discipline>/<instructor>_<edition>/<tab>/<slug> item inside a tab
```

A course URL reads as the course's natural key, for example
`/cs101/ada_2026-1`. It stays stable for the life of the edition and is safe to
paste into a chat or a syllabus.


## Decisions

### Course pages navigate by tabs

    status: adopted

Every page under a course shows the course header (code, name, instructor,
edition) and a tab strip. The strip is the only way to move between tabs, and
every tab is one click from every other. The breadcrumb only leads upward, to
pages the strip and the back-links already reach.

```
Home        /<course>
Exams       /<course>/exams
Resources   /<course>/resources
Schedule    /<course>/schedule
─────────── everyone above; whoever manages the course also sees:
Questions   /<course>/questions
Students    /<course>/roster
Grades      /<course>/grades
```

The instructor's tabs are appended, never interleaved, so the first four tabs
sit in the same positions for students and instructors. A tab the viewer cannot
open is not shown (P1). The list is computed by `courseTabs()` in
`src/utils/course-tabs.ts`.



### Items inside a tab link back to their list

    status: adopted

A page for a single exam, question or resource keeps its tab active and shows a
`← <List>` link above the item's title. Tab roots have no back-link.


### Grading belongs to an exam, the class's results to the course

    status: adopted

An instructor reaches the attempts at an exam, and the queue to grade them,
from that exam's page:

```
<course>/exams/<slug>                       results: one row per attempt
<course>/exams/<slug>/grading               the queue: the exam's questions
<course>/exams/<slug>/grading/<question>    every answer to one question
<course>/exams/<slug>/attempts/<username>   one student's attempt
```

These pages keep the Exams tab active and link back to the page above them.
Answers on the grading page carry no student name unless the URL has
`?names=1`, which the "Show names" switch sets and the links between grading
pages keep.

The Grades tab shows every student against every exam. It only reads: each
cell leads to the student's attempt and each column to its exam, where the
grading happens. It has no course total, since exams carry no weights yet.

The earlier `/gradebook` page showed fabricated data and was removed, along
with the empty Manage tab. `/manage` redirects to the Students tab.


### The top bar shows where you are once the header scrolls away

    status: adopted

The top bar is sticky, the page header is not. Once the header leaves the
viewport, a breadcrumb in the middle of the bar, aligned with the content,
says where the page sits:

```
cs201 · 2026-1 › Exams › Midterm › Grading › Two sums
cs201 · 2026-1 › Exams › Midterm › Grace Hopper
Admin › Users
Calendar
```

Crumbs use the words the pages use (P4): the course as the sidebar writes it,
tabs as the strip does, items by title, never slugs. Outside courses and admin
the trail is just the page title. Every crumb but the last is a link, and each
leads to a page that some other path also reaches; the breadcrumb is never the
only way somewhere. The grading page for one question never shows a student
name.

The breadcrumb stays in the DOM and in the accessibility tree while hidden, so
showing it shifts nothing. It is quiet text (P2) and truncates its middle crumbs
before the user menu gives up any room (P7). Phones do not show it, and keep the
`← <List>` back-links. The trail is computed by `breadcrumbs()` in
`src/utils/breadcrumbs.ts`.


## Open problems

Each item below is a proposal. Once it is decided, it moves to Decisions above.

### N1. Signing in lands on a list, not on what is next

Done: `src/pages/home.astro` shows the instructor's sections above the
student's. Push status joins it once content sync exists.

`/courses` is the landing page after login. It violates P2: a student with an
exam tomorrow sees the same grid of cards as on a quiet week. Proposal: make
Home a page for each role that leads with what needs attention (open and
upcoming exams, today's meetings, released results; for instructors, exams in
progress, pending grading and push problems), and keep `/courses` as the full
list.

Today the sidebar's Home and My courses both end on `/courses`. The target
behaviour is the "See what needs my attention" story in
`docs/user-stories/student.md` and `docs/user-stories/instructor.md`.


### N2. No visible identity

Done: the top bar has a user menu with the display name and role, holding
Profile and Log out (`src/layouts/AppLayout.astro`). Profile left the sidebar.

The top bar shows a logout icon and nothing else (violates P7). Proposal: a user
menu in the top bar with the display name and role, holding Profile and Log out.
Profile can then leave the sidebar.


### N3. Sidebar course entries are ambiguous

Done: entries read `cs101 · 2026-1`, courses the user teaches carry a
"teaching" badge, and the course tile is seeded by the course URL, so it is the
same everywhere.

Courses in the sidebar are labelled by discipline code only (`cs101`). Two
editions of the same discipline, or the same discipline taught by two
instructors, produce identical entries. The coloured dot changes with list order
rather than staying with the course. Proposal: show code and edition, mark the
courses the user teaches, and derive the colour from the course.


### N4. The footer repeats navigation and exposes internal pages

Done: the footer drops My courses and Profile; the design system link shows
in development only.

The footer repeats My courses and Profile from the sidebar and links to the
design system, which is a development page. Proposal: drop the repeated links
and hide the design system link outside development.


### N5. The calendar opens on an empty month

Done: `/calendar` without `?month` opens on the month of the next event, or of
the last one when nothing is left.

`/calendar` always opens on the current month. When the term is over or has not
started, the user sees "No events this month" and has to page through months to
find anything (violates P3). Proposal: open on the month of the next event, or
of the most recent one when nothing is left.


### N6. Getting started is hard to find

Done: every empty section of a course the viewer teaches (home, resources,
schedule, exams) links to `/getting-started` with "Set up the CLI".

`/getting-started` is linked only from the profile page. Instructors reach it
when they have nothing pushed yet, which is when an empty course page could link
to it (P6).
