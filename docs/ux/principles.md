# UX principles

The rules every Codehood screen follows. They decide questions that no single
spec owns: what a page leads with, how it talks about time, what it does when
there is nothing to show. When a page and a principle disagree, the page is
wrong, or the principle needs amending here first.

Each principle carries a status. `adopted` means new work must follow it and
existing screens that break it are bugs. `proposed` means it is written down
for discussion and does not bind anyone yet.

This directory holds the rules and the navigation model. Missing features and
broken flows are not recorded here: they go into `docs/user-stories/` as
stories, where `pnpm run stories` tracks them.


## 1. What you see is what you may do

    status: adopted

A page never has a mode. No "edit mode", no "instructor view" badge, no toggle
that changes what a URL means. Each control is shown when the viewer may use it
and absent when they may not, decided by the same permission predicates the
services enforce. An instructor opening a course sees the students' page plus
the controls only they can use.

A consequence: there is no "preview as student" button. If an instructor cannot
tell what a student sees by ignoring the controls marked as theirs, the page has
drifted and needs fixing.

Origin: the course-navigation spec, now in git history.


## 2. Every page answers "what do I do next?"

    status: adopted

A page has at most one primary action, and it depends on the state of the thing
on screen. An exam page shows "Start" before the student begins, "Continue" with
the remaining time while they are in it, and "See results" once grades are
released. Reference data (type, duration, last update) comes after the action,
never before it.

The same applies to the page someone lands on after logging in: it shows what
needs their attention, not a directory of everything they have access to.

Known violations: the exam page opens with a "Details" block that repeats its
badges and offers no action; `/courses` is the landing page and is only a list
of cards.


## 3. Time is part of the state

    status: adopted

Anything scheduled is shown relative to now. A status that depends on the clock
is derived from the clock, not read from a column someone has to update: an exam
whose window has closed never shows as "Scheduled" or "Upcoming".

Dates are written relative when they are near ("in 3 days", "closed 2 weeks
ago") and absolute when they are far or when precision matters, with the
absolute form always available on hover. Durations under pressure, such as an
exam in progress, show the time left, not the time allowed.

Known violations: a midterm dated in March still reads `SCHEDULED` and sits
under "Upcoming" in September; the calendar opens on the current month even
when every event is months away.


## 4. Speak the user's language, not the schema's

    status: adopted

Labels come from the glossary and are written for people: "Draft", "Open now",
"Graded", not `DRAFT` or `ONGOING`. Enum values, database ids and internal
slugs never appear as text on their own. Where a slug is meaningful to the user,
such as a course code, it is shown alongside a human name.


## 5. No fake data next to real data

    status: adopted

A screen shows real data, or it is visibly marked as a preview in full. It never
mixes the two. A hardcoded count beside a real one teaches the user that none of
the numbers can be trusted.

Known violations: the course home page shows a fixed "Resources 7" and two
hardcoded resource rows above the real schedule.


## 6. Empty states say who acts next

    status: adopted

An empty list explains why it is empty and points to the next step. When the
viewer can take that step, the page offers it as a button ("Join a course").
When someone else has to, the page says who and how ("The instructor publishes
the schedule with the CLI").


## 7. You always know who you are

    status: adopted

Every page shows who is logged in and with which role. People switch between
accounts (an instructor who also takes a course, an admin testing a student
account), and acting under the wrong identity is an easy mistake to make and a
hard one to notice.


## 8. The CLI writes, the web shows

    status: adopted

Course content is authored in local files and pushed with the CLI. The web does
not try to be a second editor. For instructors, it shows the state of the course
as the server holds it: what was pushed, when, from which revision, and what
failed validation. Each item that came from a file says which file, and which
command changes it.

Operations that happen during the term and have no file behind them (enrolling
students, starting or extending an exam, grading by hand, releasing results)
belong on the web.

This is the main thing that sets Codehood apart from other learning management
systems, so a feature that would turn a web page into a content editor needs a
strong case before it goes against this rule.


## 9. Destructive actions explain their consequences

    status: adopted

Before anything that removes access or data, the confirmation says what will
happen, what will not, and whether the user can undo it on their own. The
"Leave course" dialog is the reference: access ends now, submissions are kept,
rejoining needs a new invite.
