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


### See the sync status of a course

    status: todo

Instructor pushed content and wants to confirm the server has what they think it
has. The Manage tab reports what has been synced and when, so a failed push does
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
They issue a personal invite from the course, which is single-use, tied to that
address, and enrolls the student on redemption. If the student has no account
yet, redeeming the invite creates it.


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
course from the Manage tab, put it on the projector and read it out. Students in
the room type it in and are enrolled, and the code expires a few minutes later so
it does not become a link that circulates all term.

Generating and displaying the code works today. The student side that consumes it
does not exist yet, see "Join a course with an in-class passphrase".


## Questions and exams

### Author a question

    status: todo

Instructor writes a question in their local repository, of one of the supported
types, and pushes it. It belongs to the discipline rather than to one course, so
it can be reused next term. Rewriting a question that is already on a finished
exam appends a new version rather than overwriting the old one, and the exam that
pinned the previous version still shows what the students actually answered.


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

    status: todo

Instructor reads essay answers, assigns a grade and writes feedback. Answers that
were graded automatically are already done and marked as such, so the manual
queue holds only what needs a human. Something submitted empty or off-topic after
the deadline they mark will-not-grade, which is distinct from a zero and from
still being pending.


### Let a bot grade for me

    status: implemented

Instructor runs an automated grader for programming answers. They issue an API
key of kind `BOT`, and the bot posts grades and feedback back through the REST
API. It currently acts as the instructor who issued its key.


### See the whole class's results

    status: todo

Instructor wants to know how the class did, not one student at a time. The
gradebook shows every student against every exam, so an exam everybody failed is
visible as a column rather than something they have to piece together.
