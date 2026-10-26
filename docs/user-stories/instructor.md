# Instructor user stories

In all following stories, you are an instructor. Instructors own courses: they
author the content, push it, invite the students and grade what comes back.

Content is authored locally in a Git repository of plain text and pushed with the
codehood CLI. Sync is one-way, so the repository on the instructor's machine is
always the source of truth and the server never writes back to it. An instructor
sees only the courses they teach plus any they are enrolled in.


## Course management

### Get started with the CLI

    status: implemented
    url: /getting-started

Instructor has just been given an account and has no idea what to do next. The
getting-started page walks them through installing the CLI, issuing an API key,
pointing the CLI at this server and pushing a first course, in that order.

They do not have to know the page exists. Every empty section of a course they
teach, whether resources, schedule or exams, links to it, while their students
see only that nothing is published yet.


### Create a new course

    status: todo
    url: /courses/new

Instructor creates a course for a discipline and an edition. Courses are created
through the CLI, so the web page is there to hand them the exact command and
options rather than a form.


### Issue and revoke an API key

    status: implemented
    url: /profile

Instructor needs to authenticate the CLI against the server, so they create an
API key of kind `CLI` from their profile and copy it once, since it is shown once
and stored only as a hash. Later they paste a key into the wrong terminal, or
retire a laptop, and revoke that one key without disturbing the others. The CLI
using it stops being able to push immediately.


### Re-run a course for a new edition

    status: cli

Instructor teaches the same discipline again next term. They create a new course
for the new edition, which gets its own URL, schedule, enrollments and exams,
while last term's course stays untouched and readable.


### See what needs my attention

    status: implemented
    url: /

Instructor logs in during the term and wants to know what needs them today
across every course they teach. The home page leads with exams in progress and
how many students have submitted, submissions waiting to be graded by hand,
results ready to release, and courses whose question bank has validation
problems. A failed push joins this list once the sync status exists. Each item links to the page where they deal with it. When
they also take a course as a student, those items appear on the same page,
marked with the course they belong to.


### See the sync status of a course

    status: todo

Instructor pushed content and wants to confirm the server has what they think it
has. The course reports what has been synced and when, so a failed push does
not go unnoticed until a student complains.


## Authoring course content

### Push resources to a course

    status: cli

Instructor writes notes, adds a PDF and links to external material in their local
repository, then pushes. The resources appear on the course's Resources tab,
grouped by type. Nothing is authored through a web form. The same reference PDF
pushed from two different courses is stored once, addressed by the hash of its
content.


### Update or remove a resource I pushed

    status: cli

Instructor fixes a typo in a note and pushes again, and the resource updates in
place and keeps its URL rather than turning into a second copy. Later they delete
a file from the repository and push, and it disappears from the course. The bytes
go only once no other course points at them, and the old URL then explains the
file is gone.


### Define the weekly meeting times

    status: cli

Instructor declares the course's recurring slots, each one a weekday, a start
time and a duration with a slug and an optional label like "Lecture" or "Lab".
These are the skeleton the calendar hangs dated meetings off. When the lab moves
from 14:00 to 16:00 for the rest of the term they edit the time and push, and the
slot keeps its identity and its events, because the slug identifies it and the
hour does not.


### Push the term's calendar

    status: cli

Instructor authors the dated meetings for the whole term, saying what each class
covers, which week it belongs to and what kind of session it is, and pushes them
in one go. Holidays and recesses go in the same file, so the calendar reflects
the real term rather than an idealized one. A copy-paste mistake that puts two
meetings on the same slot on the same day is refused with a message naming the
clash. When they fall ill on a Tuesday they mark that one event cancelled and
push, and it stays visible to students, marked cancelled, with the rest of the
term untouched.


### Import an existing calendar

    status: cli

Instructor already keeps the term's dates somewhere else and imports the calendar
into the course rather than retyping it.


## Enrollment

### Invite a student personally

    status: implemented

Instructor knows a student's email and wants them in this course specifically.
They add the student from the roster, by email or username. Someone who already
has an account is enrolled on the spot. An address with no account behind it
gets a personal invite instead, which is single-use, tied to that address, and
creates the account already enrolled when it is redeemed.


### Hand out one join link for the whole class

    status: implemented

Instructor does not want to type forty email addresses. They generate a classroom
invite for the course, optionally capped at a number of seats, and post the link
once, and anyone holding it joins as a student. When they realise they posted it
in the wrong channel they revoke it and it stops working immediately, while the
students who already joined stay joined.


### See who is enrolled

    status: implemented

Instructor opens the Roster tab and sees the students in the course and when each
of them joined. Only the course's own instructor sees this, not other instructors
and not a non-owning admin.


### Drop and re-enroll a student

    status: implemented

A student registered for the wrong section, so the instructor drops them from the
roster and they lose access to the course contents. The submissions they already
made survive, so when the drop turns out to be a mistake, or the student comes
back, enrolling them again restores their work rather than starting them from
zero.


### Enroll the room with a passphrase

    status: web

Instructor is in front of the class on day one and wants everyone actually
present enrolled before they leave. They generate a short passphrase for the
course from the Students tab, put it on the projector and read it out. Students in
the room type it in and are enrolled, and the code expires a few minutes later so
it does not become a link that circulates all term.

Students redeem it at `/courses/join`, see "Join a course with an in-class
passphrase".


## Questions and exams

### Author a question

    status: todo

Instructor writes a question in their local repository, of one of the supported
types, and pushes it. It belongs to the discipline rather than to one course, so
it can be reused next term. Rewriting a question that is already on a finished
exam appends a new version rather than overwriting the old one, and the exam that
pinned the previous version still shows what the students actually answered.


### Browse the question bank

    status: web
    url: /[discipline]/[course]/questions

Instructor already pushed questions with the CLI and wants to check what
landed on the server: which type each one is, whether it is published or
still a draft, and when it last changed. The course's Questions tab lists
them, and opening one shows its stem, tags and current status — a read-only
mirror of what was pushed, since authoring itself still happens locally.


### Browse the exam list

    status: web
    url: /[discipline]/[course]/exams

Instructor wants to see every exam in the course — draft, scheduled or already
run — and check its type, status, schedule and duration at a glance. The
course's Exams tab lists them, sorted by whichever column they click, so
finding the one exam that is still a draft among a term's worth of quizzes
does not mean reading the whole table.


### Share a question bank with a teaching team

    status: todo

Several instructors teach the same discipline and want one shared bank. They
maintain questions as a group, where membership carries its own admin flag
independent of anyone's global role.


### Assemble and schedule an exam

    status: todo

Instructor builds an exam for a course from questions in the bank and chooses its
type. Each question is pinned to the version current at that moment, so the paper
cannot change under the students taking it. While they are still assembling it,
the exam is listed for them as a draft, on the same page and the same URL
students use rather than a parallel screen, and students do not see it at all.
Setting when it opens and closes moves it from draft to scheduled, and the
meetings it overlaps on the calendar pick up a link to it, so students find the
exam where they are already looking.


### Grade submissions by hand

    status: implemented

Instructor reads essay answers, assigns a grade and writes feedback. Answers that
were graded automatically are already done and marked as such, so the manual
queue holds only what needs a human. Something submitted empty or off-topic after
the deadline they mark will-not-grade, which is distinct from a zero and from
still being pending.


### Answer regrade requests

    status: implemented

Instructor learns from the exam page that students contested their grades. They
open the list of requests, read each justification next to the student's
answer, and either accept it with a new score or reject it. Both need a reply
for the student, and a reply left empty is refused. An answer with an open
request is marked on the grading page, and once accepted the student's grade
is the new one.


### Give a student extra time or a makeup exam

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Instructor adjusts one student's timing on an exam: extra time for a student
with special accommodations, a new date for one who missed the exam with a
medical note, or both. They add the exception from the exam page, which lists
every exception of the exam with the personal window it produces. An exception
that grants nothing is refused, and the form says so. The student's window is
the only thing that changes: the rest of the class stays closed out.

While any personal window is still ahead or running, the class's grades cannot
be released, and the page says why rather than offering the button, so nobody
sees the answer key before the makeup. When a student dropped the connection,
the instructor opens that student's attempt and reopens it, as long as the
student's window is still open, and the student continues where they stopped.
Removing an exception takes the student back to the exam's own timing.


### Let a bot grade for me

    status: implemented

Instructor runs an automated grader for programming answers. They issue an API
key of kind `BOT`, and the bot posts grades and feedback back through the REST
API. It currently acts as the instructor who issued its key.

Issuing the key and authenticating with it work today. The REST API registers
no responses or grades routes yet, so the posting half has nothing to call.


### See the whole class's results

    status: implemented

Instructor wants to know how the class did, not one student at a time. The
Grades tab shows every student against every exam, so an exam everybody failed
is visible as a column rather than something they have to piece together.

"Download CSV" saves the table as a file for a spreadsheet: one row per
student, the ones who dropped included and marked, and one column per exam
with totals as numbers from 0 to 100. A cell with no total yet is empty.


### Find the questions that need rework

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Instructor wants to know which questions of an exam are badly written, not only
which were hard. The exam page lists, for every question, how many left it blank
and its discrimination: how well it separates the students who did well on the
rest of the exam from the ones who did not. A question the best students miss
and the weakest get right is marked "review", and an exam with too few graded
attempts, or a question everybody scored the same on, shows a dash and says why.
Practice attempts never count.

The question title opens its grading page, which shows how the answers spread
over the choices: one bar per choice with its count and share, the correct one
marked, and the choices nobody picked at zero. A true-false question shows true,
false and abstained per statement. The page grades against the version of the
question the exam pins, even after the question got a newer one, and warns when
the pinned version does not exist.


### Publish the course's final grades

    status: implemented

Instructor computes the final grade on their own machine and pushes it with the
CLI as grade columns. The Grades tab shows the pushed columns after the exams,
each marked "Hidden" until they release it. "Release" asks for confirmation and
cannot be undone. From then on every student sees their own value, and a later
push of the column reaches them at once.


## Attendance

### Take the roll call in class

    status: implemented
    url: /[discipline]/[course]/schedule

Instructor is in the middle of a lecture and wants the class marked present
without a quiz. From the Schedule tab they open the roll call of that meeting; a
holiday offers no such button. They put the projection on the screen, a large QR
code with a code in text that keeps changing, and watch students appear on the
roll call page as they check in.

Students who cannot check in, because of a dead phone or a doctor's note, are
marked present by hand with a note. When two students checked in from the same
browser, both rows say so; nothing is blocked, and the instructor removes the
one who was not really there. Closing the roll call refuses any further
check-in, and reopening it gives the class another 15 minutes.


### Read the course's attendance

    status: implemented
    url: /[discipline]/[course]/attendance

Instructor wants to know who has been showing up. The Grades tab shows each
student's attendance percentage, and its header leads to the attendance page: a
table of students against the meetings that had a roll call, with present,
absent, and `-` for a meeting held before the student enrolled. That meeting
still counts as an absence in the total. A student who dropped the course stays
on the table, dimmed, with the attendance they had.

"Download CSV" saves the same table for a spreadsheet, with `1`, `0` and `-` in
the meeting columns.


## Reports

### Triage the content reports of my course

    status: implemented
    url: /[discipline]/[course]/reports

Instructor sees on the course's "Reports" tab how many reports about the
course's material are still open. Each shows the message, the page it was sent
from, the attachments and the author. They mark one as triaged with a note to
themselves, and reclassify another that is really a bug in Codehood: it goes to
the admin and leaves their queue. Reports that are not about the course's
content never reach them.
