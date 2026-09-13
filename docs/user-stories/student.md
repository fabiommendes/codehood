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

    status: todo

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


## Finding course material

### See my courses

    status: implemented
    url: /courses

Student opens the site and sees exactly the courses they are actively enrolled
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
course they are enrolled in.


## Exams and practice

### See the exams assigned to me

    status: todo

Student opens the Exams tab and sees the exams for the course with their type and
status: which are upcoming and when, which are open now, and which are finished.
Exams the instructor is still drafting are not there.


### Take an exam

    status: todo

Student opens an exam that is ongoing and answers its questions. Progress is kept
as they go, so when the browser crashes halfway through they log back in, reopen
the exam and find the answers they had already given, with the remaining time
counting from where it actually is rather than restarting. Once the exam is no
longer ongoing it stops accepting submissions.


### Practice questions outside an exam

    status: todo

Student wants to rehearse before an exam. They answer questions in a practice
session, which records their attempts separately from any graded exam and does
not affect their marks. A question they get wrong they can answer again, and the
attempts accumulate rather than overwrite, so both of them can see how the
understanding developed.


### See my grades and feedback

    status: todo

Student wants to know how they did. They see, per exam, the grade for each
question, the total, and whatever written feedback the instructor or grading bot
left. A submission still waiting to be graded says so rather than showing a zero.


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
revealing anything about the stored one. They then end every session they hold
anywhere, including the one they are using, and are sent back to the login page.


### Leave a course

    status: implemented

Student enrolled in the wrong course, or dropped it for real. They leave it
themselves and it disappears from their course list. They cannot drop anyone
else, and leaving does not destroy the work they already submitted, so an
instructor who re-enrolls them restores access to it.
