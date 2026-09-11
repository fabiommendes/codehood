# Instructor user stories

Instructors are responsible for teaching courses, managing course content, and
evaluating student performance. They have the ability to create and update
courses, as well as view and manage enrollments and student progress. They are
the main users that author content for their courses.

Content is authored locally in a Git repository of plain text and pushed with
the codehood CLI. Sync is one-way: the server never modifies content, so the
repository on the instructor's machine is always the source of truth. An
instructor sees only the courses they teach plus any they are enrolled in.

## Course Management

### Create a new course

    priority: "critical"
    url: /courses/new

Instructors can create new courses using the codehood cli. The web UI must provide
instructions to use the CLI, including the necessary commands and options.


### Get started with the CLI

    implemented: true
    priority: "high"
    url: /getting-started

Instructor has just been given an account and has no idea what to do next. The
getting-started page walks them through installing the CLI, issuing an API key,
pointing the CLI at this server, and pushing a first course, in that order.


### Issue an API key for the CLI

    tested: true
    implemented: true
    priority: "critical"
    url: /profile

Instructor needs to authenticate the CLI against the server. They create an API
key of kind `CLI` from their profile, copy it once — it is shown once and stored
only as a hash — and paste it into the CLI's configuration.


### Revoke an API key

    tested: true
    implemented: true
    priority: "high"
    url: /profile

Instructor pasted a key into the wrong terminal, or is retiring an old laptop.
They revoke that one key from their profile without disturbing the others, and
the CLI using it stops being able to push immediately.


### Re-run a course for a new edition

    implemented: "cli"
    priority: "high"

Instructor teaches the same discipline again next term. They create a new course
for the new edition, which gets its own URL, schedule, enrollments and exams,
while last term's course stays untouched and readable.


### See the sync status of a course

    priority: "high"

Instructor pushed content and wants to confirm the server has what they think it
has. The Manage tab reports what has been synced and when, so a failed push does
not go unnoticed until a student complains.


## Authoring course content

### Push resources to a course

    implemented: "cli"
    priority: "critical"

Instructor writes notes, adds a PDF and links to external material in their
local repository, then pushes. The resources appear on the course's Resources
tab, grouped by type. Nothing is authored through a web form.


### Update a resource I already pushed

    implemented: "cli"
    priority: "critical"

Instructor fixes a typo in a note and pushes again. The resource updates in
place, keeping its URL, rather than turning into a second copy alongside the old
one.


### Remove a resource

    implemented: "cli"
    priority: "high"

Instructor deletes a file from their repository and pushes. The resource
disappears from the course. The underlying bytes are only removed once no other
course points at them, and the old URL then explains the file is gone.


### Share the same file across two courses

    implemented: "cli"
    priority: "low"

Instructor uses the same reference PDF in two courses. Pushing it from both
stores one copy, addressed by the hash of its content, rather than two.


### Define the weekly meeting times

    implemented: "cli"
    priority: "critical"

Instructor declares the course's recurring slots — a weekday, a start time and a
duration, each with a slug and an optional label like "Lecture" or "Lab" — and
pushes them. These are the skeleton the calendar hangs dated meetings off.


### Move a meeting to a different hour

    implemented: "cli"
    priority: "high"

The lab moves from 14:00 to 16:00 for the rest of the term. Instructor edits the
time and pushes. The slot keeps its identity and its events, because the slug is
what identifies it, not the hour.


### Push the term's calendar

    implemented: "cli"
    priority: "critical"

Instructor authors the dated meetings for the whole term — what each class
covers, which week it belongs to, and its kind — and pushes them in one go.
Holidays and recesses go in the same file, so the calendar reflects the real
term rather than an idealized one.


### Cancel a single class

    implemented: "cli"
    priority: "high"

Instructor is ill on a Tuesday. They mark that one event cancelled and push. The
event stays visible to students, marked cancelled, and the rest of the term is
untouched.


### Import an existing calendar

    implemented: "cli"
    priority: "low"

Instructor already keeps the term's dates somewhere else. Rather than retyping
them, they import the calendar into the course.


### Be stopped from scheduling two classes in the same slot

    implemented: "cli"
    priority: "high"

Instructor makes a copy-paste mistake and schedules two meetings on the same
slot on the same day. The push is refused with a message naming the clash,
rather than quietly producing a calendar with two classes at once.


## Enrollment

### Invite a student personally

    implemented: true
    priority: "critical"

Instructor knows a student's email and wants them in this course specifically.
They issue a personal invite from the course, which is single-use, tied to that
address, and enrolls the student on redemption. If the student has no account
yet, redeeming the invite creates it.


### Hand out one join link for the whole class

    tested: true
    implemented: true
    priority: "critical"

Instructor does not want to type forty email addresses. They generate a
classroom invite for the course, optionally capped at a number of seats, and
post the link once. Anyone holding it joins as a student.


### Revoke an invite

    implemented: true
    priority: "high"

Instructor posted a join link in the wrong channel. They revoke it, and it stops
working immediately. Accounts already created from it are not affected — the
students who joined stay joined.


### See who is enrolled

    tested: true
    implemented: true
    priority: "critical"

Instructor opens the Roster tab and sees the students in the course and when
each of them joined. Only the course's own instructor sees this — not other
instructors, and not a non-owning admin.


### Drop a student

    implemented: true
    priority: "high"

A student registered for the wrong section. Instructor drops them from the
roster and they lose access to the course contents. The submissions they already
made survive, so re-enrolling them restores their work rather than starting them
from zero.


### Re-enroll a student who was dropped

    implemented: true
    priority: "low"

The drop was a mistake, or the student came back. Instructor enrolls them again
and everything they had done before is theirs again.


### Enroll the room with a passphrase

    implemented: "web"
    priority: "high"

Instructor is in front of the class on day one and wants everyone who is
actually present enrolled before they leave. They generate a short passphrase
for the course from the Manage tab, put it on the projector and read it out.
Students in the room type it in and are enrolled; the code expires on its own a
few minutes later, so it does not become a link that circulates all term.

Generating and displaying the code works today. The student side that consumes
it does not exist yet — see "Join a course with an in-class passphrase".


## Questions and exams

### Author a question

    priority: "critical"

Instructor writes a question in their local repository — multiple choice,
multiple selection, true/false, essay, short answer, numeric or fill-in — and
pushes it. It belongs to the discipline rather than to one course, so it can be
reused next term.


### Edit a question without breaking a past exam

    priority: "high"

Instructor rewrites a question that is already on a finished exam. The edit
appends a new version rather than overwriting the old one, and the exam that
pinned the previous version still shows what the students actually answered.


### Share a question bank with a teaching team

    priority: "low"

Several instructors teach the same discipline and want one shared bank. They
maintain questions as a group, where membership carries its own admin flag
independent of anyone's global role.


### Assemble an exam

    priority: "critical"

Instructor builds an exam for a course from questions in the bank, choosing its
type — practice, quiz, exam or final. Each question is pinned to the version
current at that moment, so the paper cannot change under the students taking it.


### Schedule an exam

    priority: "critical"

Instructor sets when the exam opens and closes. It moves from draft to
scheduled, and the meetings it overlaps on the calendar pick up a link to it
automatically, so students find the exam where they are already looking.


### Keep an exam hidden while drafting it

    priority: "high"

Instructor is still assembling an exam. It is listed for them, marked as a
draft, on the same page and the same URL students use — never a parallel screen
— and students do not see it at all until it is scheduled.


### Grade submissions by hand

    priority: "critical"

Instructor reads essay answers, assigns a grade and writes feedback. Answers
that were graded automatically are already done and marked as such, so the
manual queue only contains what actually needs a human.


### Let a bot grade for me

    implemented: true
    priority: "high"

Instructor runs an automated grader for programming answers. They issue an API
key of kind `BOT`, and the bot posts grades and feedback back through the REST
API. It currently acts as the instructor who issued its key.


### Decline to grade a submission

    priority: "low"

A student submitted something empty or off-topic after the deadline. Instructor
marks it as will-not-grade, which is distinct from a zero and from still being
pending.


### See the whole class's results

    priority: "critical"

Instructor wants to know how the class did, not one student at a time. The
gradebook shows every student against every exam, so an exam everybody failed
is visible as a column rather than something they have to piece together.
