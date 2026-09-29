# Navigation

How people move through Codehood: the regions of the screen, the URL scheme,
and the decisions behind them. Principles referenced as P1, P2, and so on are in
[principles.md](principles.md).


## Screen regions

Signed-in pages use `AppLayout`:

- **Top bar.** Logo (links home), theme toggle, logout.
- **Sidebar.** Global destinations (Home, My courses, Calendar, Profile, and
  Admin for admins), then one entry per course the user takes or teaches. It
  collapses into a drawer below the `lg` breakpoint.
- **Content.** The page itself. Course pages start with the course header and
  tab strip.
- **Footer.** Logo and a few repeated links.

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
/admin, /admin/*                    admin area (AdminTabs)
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
edition) and a tab strip. The strip is the only navigation inside a course, and
every tab is one click from every other.

```
Home        /<course>
Exams       /<course>/exams
Resources   /<course>/resources
Schedule    /<course>/schedule
─────────── everyone above; whoever manages the course also sees:
Questions   /<course>/questions
Students    /<course>/roster
Manage      /<course>/manage
```

The instructor's tabs are appended, never interleaved, so the first four tabs
sit in the same positions for students and instructors. A tab the viewer cannot
open is not shown (P1). The list is computed by `courseTabs()` in
`src/utils/course-tabs.ts`.

Origin: `dev/specs/to-review/course-navigation.md`.


### Items inside a tab link back to their list

    status: adopted

A page for a single exam, question or resource keeps its tab active and shows a
`← <List>` link above the item's title. Tab roots have no back-link.


### The gradebook belongs to an exam, not to the course

    status: adopted

The gradebook has no tab. An instructor reaches it from the exam whose
submissions they want to see.

Known issue: nothing links to `/gradebook` yet, so it can only be reached by
typing the URL.


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
