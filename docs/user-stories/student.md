# Student user stories

In all following stories, you are a student. Students consume a course through
the web app: they read the material an instructor pushed, follow the schedule,
answer questions and check their grades. A student sees only the courses they
have an active enrollment in. There is no catalog to browse, and they cannot
list their classmates. The CLI works for students too, but is never required.


## Joining the platform

### Redeem a personal invite

    status: implemented
    url: /invite/[token]

Student opens the invite link an instructor emailed them. The page says who
invited them, which course they are joining and the role the account will get.
The email field is filled in and locked, since the invite was issued for that
address. They pick a username, a display name and a password, supply their
GitHub handle and school id, and land logged in on their courses page with the
enrollment already in place.

A link they sit on for weeks, or one a classmate already used, says which of the
two happened instead of showing a generic error, so they know to ask for a new
one rather than retry.


### Redeem a classroom invite link

    status: implemented
    url: /invite/[token]

Instructor drops a single join link in the class chat. Student opens it and
fills in their own email, since the link is not addressed to anyone in
particular. If the link has a seat limit and the class has used it up, the page
says the invite is exhausted rather than handing them a form that cannot work.


### Join a course with an in-class passphrase

    status: implemented
    url: /courses/join

Student is sitting in the first lecture with an account already, and the
instructor puts a six-character code on the projector. Student types it in and
is enrolled there and then. The code alone says which course it is, so they are
never asked to pick one from a list.

The code lives for about five minutes, so a screenshot sent to a friend who
skipped the class is useless by the time they open it. An expired code and an
unknown one give different messages, because a student who mistyped and a
student who is too late need different advice.


### Log in

    status: implemented
    url: /login

Student returns on a new device and cannot remember which address they signed up
with, so they try their username instead, which the form accepts just as well as
an email. They then fumble the password. The refusal says the credentials are
wrong without saying which half, and the second attempt gets them in.

Signed in, hitting the site's root shows their home page rather than the
marketing landing page, which stays reserved for a visitor with no session.


## Finding course material

### See what needs my attention

    status: implemented
    url: /

Student logs in the evening before a busy day and wants to know what is coming,
without opening each course. The home page leads with what needs them: an exam
that is open now and how long it has left, the exams coming up in the next days,
today's meetings across every course, and results released in the last
week. Each item links straight to the page where they act on it. On a quiet
week the page says there is nothing pending and shows the next thing on the
calendar, however far away it is.


### See my courses

    status: implemented
    url: /courses

Student opens My courses and sees exactly the courses they are actively enrolled
in, each one linking to its course page. A course they dropped, or were dropped
from, is not in the list.

They follow a link a classmate sent to some other course and get a 403 that
names it, which is how they tell it apart from a URL that does not exist at all
and answers 404. On their own course, the Manage and Roster tabs answer 403 too.
Being in a course is not the same as running it, and students cannot list their
classmates.


### Read the course home page

    status: implemented

Student opens a course and sees what it is about, who teaches it, and the next
few meetings coming up, without hunting through tabs for the thing that happens
tomorrow.


### Browse course resources

    status: implemented
    url: /files/[hash]/[name]

Student opens the Resources tab and finds the material the instructor pushed:
files to download, links to follow, notes to read and code snippets to copy.
They are grouped by type in a fixed order, so the same thing is always in the
same place across courses. Clicking a file gives them the bytes under its
original filename.

An old link to a file the instructor has since removed, from a bookmark or a
chat log, explains that the file was removed rather than answering a bare 404
that looks like the site is broken.


### Run a code example

    status: implemented
    url: /[discipline]/[course]/resources/[slug]

Student opens a JavaScript or Python code example in the course resources and runs it
right there, without installing anything. The output appears in a terminal under
the code. When the program asks for input, they type a line in the terminal and
the program carries on. They can change the code and run it again, or go back to
the original. Nothing they do is saved.

Examples in a language that cannot run in the page stay plain text, with no Run
button.


### Follow the course schedule

    status: implemented

Student opens the Schedule tab and sees the course's weekly meetings and every
dated occurrence of them: which week each one belongs to, what kind of session
it is, and what it covers. A meeting the instructor cancelled stays on the list,
visibly cancelled, so a student who did not open the app that day can still see
later why nothing happened.


### See all my courses in one calendar

    status: implemented
    url: /calendar

Student is enrolled in several courses at once and wants one view of the week
rather than one tab per course. The personal calendar merges the events of every
course they are enrolled in, and the exams and quizzes that have a date sit on
their day next to the meetings, marked as such and linking to the exam. Exams
the instructor is still drafting are not there.


### Open the calendar on the next event

    status: implemented
    url: /calendar

Student opens the calendar in the break between terms. Instead of an empty
current month, it opens on the month of their next event. When nothing is left,
it opens on the month of the last one, so the calendar never starts on a blank
page while the student has events somewhere.


## Course repositories

### Find a course repository

    status: todo
    url: /[discipline]/[course]/repositories

Student opens a course whose instructor published code alongside the material.
The Repositories tab appears, after Schedule, and lists each repository with its
title and the date and message of its latest commit. A course with no
repository, or whose repositories have not received a first push, shows no such
tab. On the Schedule, the card of a class lists the repositories tied to it next
to its resources, and following one leads to its page.


### Read and download a course repository

    status: todo
    url: /[discipline]/[course]/repositories/[slug]

Student opens a repository and finds the `git clone` command with a button to
copy it, a "Download zip" button for those who do not use git, and the root of
the files with the README shown below. They open a source file and read it with
syntax highlighting, and enter a folder whose README is shown under its
listing. A path that does not exist in the repository answers "not found".
"Download zip" saves the files of the latest commit as one archive.


## Exams and practice

### See the exams assigned to me

    status: implemented

Student opens the Exams tab and sees the exams for the course with their type and
status: which are upcoming and when, which are open now, and which are finished.
Exams the instructor is still drafting are not there.

The status follows the clock. An exam whose window has closed is listed as
finished even if nobody touched it since, and dates near today read as "in 3
days" or "closed yesterday", so the student never has to compare a date with
the calendar to know whether they missed something.


### Take an exam

    status: implemented

Student opens an exam that is open and answers its questions. Progress is kept
as they go, so when the browser crashes halfway through they log back in, reopen
the exam and find the answers they had already given, with the remaining time
counting from where it actually is rather than restarting. When they are done
they press "Submit exam", and a confirmation warns that the answers cannot be
changed afterwards. Once the exam closes it stops accepting submissions.


### See what each question is worth

    status: implemented
    url: /[discipline]/[course]/exams/[exam]

Student answering an exam sees, beside each question, its number and how many
points out of 100 it carries, so they can spend their time where it counts. After
the grades are released the same labels sit on each reviewed question, and the
total is the weighted one: missing a heavy question costs more than missing a
light one.


### Run my code answer before submitting

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Student answers a code question in an editor and presses Run to see what the
program prints, as many times as they like, before submitting. Running never
turns the code into an answer: only the text in the editor is saved, as they
type, with the time of the last save under it. Practice exams run code by
default; quizzes and exams do not, unless the instructor turned it on, and then
the student sees that the instructor disabled code execution and still writes
and submits the answer. When the browser could not reach the server, the footer
says since when, and the code stays in a draft in that browser. If they reopen
the exam and the draft differs from what the server has, they see both versions
side by side and pick the one to continue from.


### Answer an exam with the extra time I was granted

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Student with extra time or a makeup date opens the exam and sees their own
timing: "30 min for you" beside the duration, or the new date when they were
given a second chance. The exam is open for them when their personal window is,
even after it closed for the rest of the class, and they answer it like any
other exam, with the countdown running to their own deadline. A classmate with
no exception sees the same exam closed.


### Use the files attached to an exam question

    status: todo
    url: /<discipline>/<course>/exams/<exam>

Student opens an exam whose questions come with files, such as a dataset to
analyse or a starter program. Before the exam opens, the page shows no
attachments and the download links answer "not found", so nothing leaks early.
Once it is open, the exam's own attachments show up under its instructions and
each question lists its files right below the statement. They download with
their original names, and a file the instructor wrote inline shows its code in a
collapsed block that the student can open and read without downloading.


### Answer an exam question with files

    status: todo
    url: /<discipline>/<course>/exams/<exam>

Student opens a question that asks for files, such as a diagram or a report. It
says how many files it takes, how large each may be and which types it accepts.
They pick a program or a file that is too large and are told why it was not
accepted, without losing anything already sent. Then they send a PDF and an
image, and see both listed with their sizes. Sending a file with the same name
replaces it, a third file is refused while two are kept, and the cross beside a
file removes it, and "Clear" removes all of them after asking for confirmation.
Each file is stored as soon as it is sent, so after a reload the list is still
there, and a clear that failed never takes away a file sent afterwards.


### Practice questions outside an exam

    status: todo

Student wants to rehearse before an exam. They answer questions in a practice
session, which records their attempts separately from any graded exam and does
not affect their marks. A question they get wrong they can answer again, and the
attempts accumulate rather than overwrite, so both of them can see how the
understanding developed.


### See my grades and feedback

    status: implemented

Student wants to know how they did. They see, per exam, the grade for each
question, the total, and whatever written feedback the instructor or grading bot
left. A submission still waiting to be graded says so rather than showing a zero.


### See which rubric items shaped my grade

    status: todo
    url: /<discipline>/<course>/exams/<exam>

Student opens an exam whose grades were released and sees, under each answer
graded with a rubric, the items that applied to it with their value and the
feedback written for them, followed by the instructor's free comment. Items that
did not apply, and the notes the instructor kept for themselves on each item,
are not shown. Before the release they see none of it.


### Ask for a regrade

    status: implemented
    url: /exams

Student disagrees with the grade of one question of an exam whose grades are
out. They ask for a regrade with a short justification, which the instructor
sees; a justification that is too short is refused. Until the instructor
answers they can withdraw the request and ask again. Once answered, the
request shows as accepted, with the new grade, or rejected, with the
instructor's reply, and each answer can be contested only once, within two
weeks of the release.


### See the adjustments to my grade

    status: implemented
    url: /<discipline>/<course>/exams/<exam>

Student's grade on an exam was changed by the instructor: replaced, raised by
a bonus or reduced by a penalty. Before the grades are released the exam page
shows no sign of it. Afterwards it shows the original total, one line per
adjustment with the reason the instructor wrote, and the final total, which
never passes 100%; a question that was zeroed or reduced is marked. The
instructor's private notes are never shown. A grade under a penalty cannot be
contested with a regrade request, while one with only a bonus or a
replacement still can.


### See a grade for an exam I did not take

    status: todo
    url: /<discipline>/<course>/exams/<exam>

Student missed an exam and the instructor gave them a grade for it anyway, such
as the project's grade or a makeup's. Once the grades are released, the exam
page says that they did not take the exam, shows the grade it was replaced by
with the instructor's reason, and the total. It shows no answers, and before
the release it shows nothing of the grade.


### Read the questions of an exam I missed

    status: todo
    url: /<discipline>/<course>/exams/<exam>

Student did not take an exam and wants to study what it asked. While the exam
is closed but the grades are not out, the exam page shows no question. Once the
grades are released the page lists the questions in the exam's order, to be
read only: no field to answer, no button to submit, no answer key and no
review.


### See a question grade my instructor changed

    status: todo
    url: /<discipline>/<course>/exams/<exam>

Student's grade on one question was changed by the instructor after the
grading. Once the grades are released they see their own answer as they gave
it, the new grade and the instructor's comment, and the total counts the new
grade. A question they left blank still reads as unanswered, with the grade and
the comment beside it.


### See my course grades

    status: implemented

Student wants to know where they stand in the course, beyond each exam. The
course home lists the grades the instructor released, such as the assignments
score and the final grade, each with the student's own value. A grade the
instructor has not released yet is not mentioned, and one with no value for
the student reads "No grade".


## Assignments

### Form a team and follow the delivery

    status: implemented
    url: /[discipline]/[course]/assignments/[slug]

Student opens an assignment done in teams and sees from the list that they have
no team yet. They create one by name, and a name that is empty or already taken
is refused. The page then shows the team's code, their personal clone URL and
a warning while the team is below the minimum size. A classmate who types a
wrong code is told so and joins with the right one; a third classmate is turned
away by a full team.

After the first push the page says the work was delivered on time, with the
commit, who pushed it and when, lists every push, and warns about required
files still missing from `main`. The student can ask for a new clone URL, which
replaces the old one. For a shared computer they generate a temporary clone
URL, shown next to the permanent one with the time it stops working: asking
again replaces it, and revoking it takes it off the page. Leaving the team is
possible until teams lock, except for the last member of a team that already
has a push.


### Do an individual assignment

    status: implemented
    url: /[discipline]/[course]/assignments/[slug]

Student opens an assignment that is done alone. The list says they have no
repository yet, and the page offers one button to create it; nothing on the
page talks about teams, members, codes or leaving. After creating the
repository they find their clone URL and the commands for a first push, and
once they push, the page reads "your delivery".


### See where I stand after the deadline

    status: implemented
    url: /[discipline]/[course]/assignments/[slug]

Student opens assignments whose due date has passed. A delivery made in time
stays pinned, with a later push shown beside it as a late delivery; with only
late pushes the page says nothing was delivered on time. A deadline the
instructor extended appears marked as extended with the original beside it.
Once pushes close, the page says so and the clone stays available.

A student who never joined a team before teams locked is told to look for the
instructor. An assignment that has not opened yet is missing from the list, and
its address answers "not found".


### Follow the checkpoints of an assignment

    status: implemented
    url: /[discipline]/[course]/assignments/[slug]

Student opens an assignment that has checkpoints, the intermediate dates the
instructor set. The deadlines list each one by its title and date, before the
due date. The team panel shows one line per checkpoint: one that is still ahead
says so, one that has passed shows the commit that was the tip of `main` at
that instant, with who pushed it and when, and one that passed before the first
push says that nothing was pushed. In the push history, the push that counts
for a checkpoint carries its title, and one push may count for more than one.


## Managing my account

### Update my profile

    status: implemented
    url: /profile

Student changes their display name, email, GitHub handle or school id. If the new
value belongs to someone else already, the message names the field that collided
instead of failing generically. The username is not editable, because it is part
of the URL of every course an instructor owns.


### Change my password and log out everywhere

    status: implemented
    url: /profile

Student used a lab machine and forgot to log out. They change their password,
confirming the current one first, and a wrong current password is refused without
revealing anything about the stored one. The change ends every other session they
hold, the lab machine's included, while leaving the browser in front of them
signed in. To end that one too they log out everywhere, which sends them back to
the login page.


### Leave a course

    status: implemented

Student enrolled in the wrong course, or dropped it for real. They leave it
themselves and it disappears from their course list. They cannot drop anyone
else, and leaving does not destroy the work they already submitted, so an
instructor who re-enrolls them restores access to it.


### Subscribe to my calendar in another app

    status: implemented
    url: /profile

Student lives in their phone's or laptop's calendar app, not on the site. In
the Calendar tab of their profile they create a private link and paste it into
the app, which then lists their course's meetings and published exams, never an
exam still in draft. The link is a secret: generating a new one makes the old
address stop working at once, and deactivating it removes the feed until they
create another. The Calendar page points them to the tab.


## Attendance

### Check in to class

    status: implemented
    url: /check-in

Student is in the lecture and the instructor projects a QR code. They scan it
and are marked present. If they are logged out, they log in first and come back
to the confirmation. A code that is mistyped or that has already rotated away
is refused with a message that says which.

Another meeting's code can be typed at the check-in page instead. Afterwards
the course home shows how many of the roll calls they attended, and the
Schedule tab marks each past meeting that had one as present or absent. The
attendance page shows only their own row.


### Join the class through the roll call

    status: implemented
    url: /c/[rollCallId]/[code]

Instructor opened the roll call as an invite, so the code on the projector also
works as the class's join link. A student with an account but no enrollment is
enrolled and marked present by scanning it. A student with no account fills in
the sign-up form on the same page and ends up with an account, an enrollment
and the attendance. A roll call that is not an invite refuses someone who is not
in the course. The instructor sees the newcomers flagged as new in this class.


## Reporting problems

### Report a problem

    status: implemented
    url: any page, from the user menu or the footer

Student hits something broken, or a question that looks wrong, and opens
"Report a problem". The dialog already holds a screenshot of the page and
guesses the type: course content on a question, exam or material page, a bug
anywhere else. A message too short to act on is refused before it is sent. The
student can drop the screenshot, which may show more than they want to share,
and add up to three images in total. After sending, the report shows up under
"My reports" on their profile with its status, and they can delete it while
nobody has triaged it yet. Nobody answers inside Codehood: the status is all
the author sees.
