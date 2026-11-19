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


### Check a course's settings

    status: implemented

Instructor wants to confirm what the server holds for a course and set up a
new machine for it. They open Settings from the course card on the course
home and see the discipline, edition, instructor, dates and description, each
with the file of the course repository it comes from, since those change with
a push and not on the page. The same page gives the `codehood init` command
already filled in for this course, and `codehood login`, ready to copy. Only
the course's own instructor reaches it.


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


### Find my way around a course home

    status: implemented
    url: /[discipline]/[course]

Instructor opens a course and wants to reach the schedule, the exams or the
resources without scrolling. The sections come in that order, the sidebar links
to each of them, and the exams section previews a few exams and links to the
full list.


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


## Course repositories

### Share a repository with the class

    status: todo
    url: /[discipline]/[course]/repositories/[slug]

Instructor creates a repository with the CLI. Until the first push, its page
only says it is waiting for the first push and shows the command to run; students
do not see it yet. After the push they open the page, walk the folders down to a
file and read it as students do. When a clone URL leaks, they ask for a new one
and confirm in the form: the page then shows a different URL, and the old one
stops working.


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

Instructor does not want to type forty email addresses. From the course settings
they generate a classroom invite for the course, optionally capped at a number of seats, and post the link
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
course from the course settings, put it on the projector and read it out. Students in
the room type it in and are enrolled, and the code expires a few minutes later so
it does not become a link that circulates all term.

Students redeem it at `/courses/join`, see "Join a course with an in-class
passphrase".


## Questions and exams

### Author a question

    status: todo

Instructor writes a question in their local repository, of one of the supported
types, and pushes it. It belongs to the course it was pushed to; reusing it next
term means pushing the same file to the new course. Rewriting a question that is
already on a finished exam appends a new version rather than overwriting the old
one, and the exam that pinned the previous version still shows what the students
actually answered.


### Browse the question bank

    status: web
    url: /[discipline]/[course]/questions

Instructor already pushed questions with the CLI and wants to check what
landed on the server: which type each one is, whether it is published or
still a draft, and when it last changed. The course's Questions tab lists
them, and opening one shows its stem, tags and current status. The content is
a mirror of what was pushed, since authoring happens locally, but the status is
not: a button on each row publishes, archives or moves the question back to
draft.


### Preview the files attached to a question and an exam

    status: todo
    url: /[discipline]/[course]/questions/[question]

Instructor pushed a question and an exam that come with files and wants to see
what students will get. The question page lists the question's files under its
statement, and the exam page lists the exam's files under its instructions and
each question's files under that question, even before the exam opens. A
question without files shows no list. Every file downloads from the page. When
the question was rewritten after the exam pinned it, the exam still offers the
files of the version it pinned, while the question page offers the newest ones.


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

Several instructors teach the same discipline and want to see each other's
questions. The owner of a question that declares a uuid shares it from the web,
and any other instructor can then read it in full, but not change it. A
question with no uuid cannot be shared, and the page says what to add. To reuse
a shared question, an instructor copies its file into their own repository and
pushes it to their course.


### Assemble and schedule an exam

    status: todo

Instructor writes an exam in the course repository, choosing its type and its
questions from the bank, and pushes it with the CLI. When the exam starts, as
the first attempt is opened, each question is pinned to its current version, so
the paper cannot change under the students taking it. While they are still
assembling it, the exam is listed for them as a draft, on the same page and the
same URL students use rather than a parallel screen, and students do not see it
at all. Setting when it opens and closes moves it from draft to scheduled, and
the exam appears on its date in the course schedule and in students' calendars,
next to the meetings, so students find it where they are already looking.


### Simulate an exam as a student

    status: web
    url: /[discipline]/[course]/exams/[exam]/preview

Instructor wants to know that an exam works before the class takes it, draft
or not. The exam's Preview tab is the student's own screen, with the timer, the
autosave and the submit button, under a banner that says the simulation counts
for nothing. Submitting shows the result at once, with the essays left to
manual grading and a link to each answer key. Restarting discards the answers
and begins another simulation. The simulation never appears in the exam's
results, its statistics, the grading queue or the course grades.


### Grade an exam whose questions have different weights

    status: implemented
    url: /[discipline]/[course]/exams/[exam]

Instructor gives some questions of an exam more weight than others. Wherever the
exam lists its questions, in the grading queue, on each question's grading page,
in the question statistics, on a student's attempt and in the regrade requests,
each one is labelled `Q1`, `Q2`... with the points it carries out of 100, so
"what was your answer to Q2?" means the same thing to everyone. The total in the
results table is the weighted one, not the plain average.


### Grade submissions by hand

    status: implemented

Instructor reads essay answers, assigns a grade and writes feedback. Answers that
were graded automatically are already done and marked as such, so the manual
queue holds only what needs a human. Something submitted empty or off-topic after
the deadline they mark will-not-grade, which is distinct from a zero and from
still being pending.


### Run a student's code while grading

    status: implemented

Instructor grades a code question and does not want to run each answer by hand.
The grading page shows the code highlighted, with a Run button when the
language has a runner. The answer runs in the browser in a sandbox of its own,
and moving to another answer replaces it. If the program asks for input, they
type it in the terminal; a loop that never ends is cut with Stop. They can edit a
copy to test a fix: it is marked as modified, lives only in the page and goes
away with Back to submission. Running never changes the grade or the comment.


### Grade an exam question with a rubric

    status: todo
    url: /<discipline>/<course>/exams/<exam>/grading/<question>

Instructor opens a question from the grading queue and lands on the first
pending answer, with a header saying which answer of how many it is, how many
are pending and how many are to review. They grade from the keyboard: a digit
picks a group of the rubric or toggles a loose item, a letter picks the option
inside the group, and Enter saves and moves to the next pending answer. The
score is computed live from the items applied and the adjustment. Typing in the
comment field never fires a shortcut, and an item with no text or a value that
is not a number is refused when they create one.

Answers that differ only in whitespace sit next to each other, so the same
remark is applied in a row. When an answer shows something the rubric did not
foresee, they press `n` and create an item that is already applied to it and
available to every later answer. The list view of the question still shows every
answer with the items applied.


### Change the rubric while grading

    status: todo
    url: /<discipline>/<course>/exams/<exam>/grading/<question>

Instructor realizes mid-grading that an item is worth more or less than they
thought. In edit mode they change its value, and before anything is written the
page says how many grades change and how many of them students already read.
Cancelling leaves every grade as it was; confirming recomputes them all, so the
class is graded by one rule rather than by what the rubric said that morning.

When one item turns out to lump together two different mistakes, they split it.
Answers that applied it keep their score and are marked to review, the grading
queue says how many are to review in each question, and regrading one with the
new items clears its mark.


### Answer regrade requests

    status: implemented

Instructor learns from the exam page that students contested their grades. They
open the list of requests, read each justification next to the student's
answer, and either accept it with a new score or reject it. Both need a reply
for the student, and a reply left empty is refused. An answer with an open
request is marked on the grading page, and once accepted the student's grade
is the new one.


### Adjust a student's grade

    status: implemented
    url: /<discipline>/<course>/exams/<exam>/attempts/<username>

Instructor changes what a student got on an exam after the grading: a bonus
for class participation, the project's grade in place of the exam's, or a
penalty for cheating that a regrade must not undo. From the student's attempt,
or for several students at once from the exam's results, they add points,
multiply the grade or replace it, with a reason the student reads and private
notes only instructors read; a preview shows the new total before they save.
A value out of range, a second replacement on the same attempt and a bonus on
a single question are refused and nothing is saved.

Adjustments add up: a penalty and a bonus on the same student both apply, the
total never passes 100%, and zeroing the exam gives zero whatever else was
granted. A single question can only be reduced or zeroed, from the question
itself. The results show the original total struck through beside the final
one, and the exam's Adjustments page lists every adjustment, active and
revoked, where they edit or revoke one and the student gets the earlier total
back.


### Review an automatically graded question

    status: implemented
    url: /<discipline>/<course>/exams/<exam>/grading/<question>

Instructor checks that a question the server graded by itself was keyed right.
The question's grading page has no answer-by-answer list: it counts the answers
and the share that got it right, and groups identical responses, each group
with how many students gave it, the score it got and how those students did on
the rest of the exam. A wrong response chosen by students who do well elsewhere
is marked for review, which is how a wrong answer key shows up. Every objective
type has its own grouping: per choice, per statement, per blank, per value, per
order.

"Needs attention" appears only when an answer has no grade or a regrade request
is open, and lets them grade the first and open the second. From a group they
open its students, by name, and change the grade of one. Answers changed by hand
are listed apart with the automatic grade struck through, and Undo gives it
back. There is no action on a whole group, and the page says that pinning a new
version of the question does not grade the existing answers again.


### Change the grade of one question

    status: todo
    url: /<discipline>/<course>/exams/<exam>/attempts/<username>

Instructor decides that one student deserves another grade on a question: the
answer key was wrong for their answer, or they solved the in-class challenge
that turns a wrong question into a right one. On the student's attempt each
question has Change grade: mark it as correct or type a grade from 0 to 100,
with a comment the student reads. The grade is for the whole question, even
when it has blanks or statements. A question the student left blank can be
graded the same way and still reads as unanswered. While the exam is still
open for that student a blank question cannot be graded, and the page says so.
A grade given to a blank question does not count as an answer in the
question's statistics; a changed grade on a real answer does.


### Grade a student who did not take the exam

    status: implemented
    url: /<discipline>/<course>/exams/<exam>/results

Instructor gives a grade to a student with no attempt at an exam: the project
replaces the exam, or the student sat a makeup on paper. In the exam's results
they select the student, alone or with others, and replace the grade, with a
reason. The student then has a total and an attempt with no answers, and
further adjustments land on that same attempt. It is refused while the exam is
still open or yet to open for that student, extra time and makeup dates
included, for someone who is not enrolled, and on a practice exam; nothing is
saved then. A grade given this way does not hold back the release of the
class's grades.


### Find a student in a large class

    status: implemented
    url: /<discipline>/<course>/exams/<exam>/attempts/<username>

Instructor has a student in mind and a class of eighty. From any attempt of the
exam they open the list of students, type a name, a username or the school id
the student remembers, and sort by total or by situation: pending, no attempt,
adjusted, delivered. A row opens that student's attempt; arrows step to the
previous and the next one. Inside an attempt a bar with Q1 to QN stays in view,
each question coloured by how it went, and leads to the question.


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


### Release an exam's grades

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Instructor finished grading an exam and wants the class to see the results.
The exam page offers "Release results" once the exam is closed and nothing is
left to grade, behind a confirmation that says what students will see and that
it cannot be undone. After confirming, the page says when the grades were
released and every student sees their grade and feedback. Quizzes need no such
step: their grades come out on their own once the quiz closes.


### Close an exam with no deadline

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Instructor opened an exam with no date or no duration, so nothing closes it and
its grades cannot be released. The exam page warns that it stays open until
they close it, and says how many attempts are in progress. "Close exam" asks
for a confirmation that repeats the number. After it, the exam is completed and
the attempts in progress end as if their time had run out: what was saved
counts and the objective answers are graded. A student with an exception whose
window is still open keeps answering inside it. The same happens when the
instructor completes the exam through the REST API.


### Let a bot grade for me

    status: implemented

Instructor runs an automated grader for programming answers. They issue an API
key of kind `BOT`, and the bot posts grades and feedback back through the REST
API. It currently acts as the instructor who issued its key.

The bot reads the course's submissions and posts a score and a comment on each
one as feedback, through the same REST API the CLI uses.


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


## Assignments

### Compose the teams of an assignment

    status: implemented
    url: /[discipline]/[course]/assignments/[slug]

Instructor opens an assignment done in teams and reads the summary: how many
teams, how many enrolled students have none, how many delivered on time and how
many only late, with the CLI commands that list and download the deliveries
below it. The table shows each team's members, size and deliveries; a team
outside the size range is marked as an exception, with the reason spelled out
for screen readers, and an extended deadline is marked too.

They create a team, add a student with no team, and move one from another team
after a confirmation that names the team they leave. They take a member out,
rename a team (a taken name is refused) and delete one after a confirmation that
says how many pushes will be lost. Students left without a team are listed with
a way to put each one in a team.


### Follow an individual assignment

    status: implemented
    url: /[discipline]/[course]/assignments/[slug]

Instructor opens an assignment done alone. The table lists students, not teams:
each one's deliveries, an extended deadline marked as such, and "no repository"
for those who have not created theirs. There is nothing to compose, so no team
actions are offered. An assignment that has not opened yet is visible to the
instructor and hidden from students.


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
