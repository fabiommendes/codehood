# Student user stories

In all following stories, you are a student. Students consume a course through
the web app: they read the material an instructor pushed, follow the schedule,
answer questions and check their grades. A student sees only the courses they
have an active enrollment in — there is no catalog to browse, and they cannot
list their classmates. The CLI works for students too, but is never required.


## Joining the platform

### Redeem a personal invite

    tested: true
    implemented: true
    priority: "critical"
    url: /invite/[token]

Student receives an invite link by email from an instructor or admin. Opening it
shows who invited them, which course they are joining, and the role the account
will get. The e-mail field is pre-filled and cannot be changed, since the invite
was issued for that address. Student picks a username, a display name and a
password, supplies their GitHub handle and school id, and lands logged in on
their courses page with the enrollment already in place.


### Redeem a classroom invite link

    tested: true
    implemented: true
    priority: "high"
    url: /invite/[token]

Instructor drops a single join link in the class chat. Student opens it and
fills in their own email, since the link is not addressed to anyone in
particular. If the link has a seat limit and the class has already used it up,
student is told the invite is exhausted rather than getting a broken form.


### Join a course with an in-class passphrase

    priority: "high"

Student is sitting in the first lecture with an account already, and the
instructor puts a six-character code on the projector and reads it out. Student
types it in and is enrolled in the course there and then, without a link to
click or an email to wait for. The code alone says which course it is, so they
are never asked to pick one from a list.

The code is deliberately awkward to pass on: it lives for about five minutes and
then stops working, so a screenshot sent to a friend who skipped the class is
useless by the time they open it. Typing an expired or unknown code says which
of the two it was, since a student who mistyped and a student who is too late
need different advice.


### Fail to redeem a stale invite

    tested: true
    implemented: true
    priority: "high"
    url: /invite/[token]

Student comes back to an invite link weeks later, or clicks a link a classmate
forwarded that was addressed to someone else. Instead of a generic error, the
page explains which of the three happened: the invite expired, it was issued for
a different email address, or it has already been used.


### Log in with either a username or an email

    tested: true
    implemented: true
    priority: "critical"
    url: /login

Student returns to the site on a new device. They may not remember which address
they signed up with, so the login form accepts their username just as well as
their email.


## Finding course material

### See my courses

    tested: true
    implemented: true
    priority: "critical"
    url: /courses

Student opens the site and sees exactly the courses they are actively enrolled
in, each one linking to its course page. A course they dropped, or were dropped
from, is not in the list.


### Be refused a course I am not enrolled in

    tested: true
    implemented: true
    priority: "high"

Student guesses or is sent the URL of a course they are not enrolled in. They
get a 403 that names the course, so they can tell it apart from a course URL
that does not exist at all, which gives a 404.


### Be refused the instructor's pages on my own course

    tested: true
    implemented: true
    priority: "high"

Student is properly enrolled and follows a link to the course's Manage or Roster
tab — from the instructor's screen share, or by editing the URL. They get a 403.
Being in the course is not the same as running it, and students cannot list
their classmates.


### Read the course home page

    implemented: true
    priority: "critical"

Student opens a course and sees what it is about, who teaches it, and the next
few meetings coming up, without having to hunt through tabs for the thing that
happens tomorrow.


### Browse course resources

    implemented: true
    priority: "critical"

Student opens the Resources tab and finds the material the instructor pushed:
files to download, links to follow, notes to read and code snippets to copy.
They are grouped by type in a fixed order, so the same thing is always in the
same place across courses.


### Download a file resource

    implemented: true
    priority: "high"
    url: /files/[hash]/[name]

Student clicks a file resource and gets the bytes, with the original filename
preserved so it lands in their downloads folder under a name that means
something.


### Be told when a file is gone rather than get a dead link

    implemented: true
    priority: "low"

Instructor removed a file resource and pushed the change. Student follows an old
link — a bookmark, or a link from a chat log — and gets a page explaining the
file was removed, rather than a bare 404 that looks like the site is broken.


### Follow the course schedule

    implemented: true
    priority: "high"

Student opens the Schedule tab and sees the course's weekly meetings and every
dated occurrence of them: which week each one belongs to, what kind of session
it is (lecture, lab, exam, holiday), and what it covers.


### See all my courses in one calendar

    implemented: true
    priority: "high"
    url: /calendar

Student is enrolled in several courses at once and wants one view of the week
rather than one tab per course. The personal calendar merges the events of every
course they are enrolled in.


### Know a class was cancelled

    implemented: true
    priority: "low"

Instructor marks a meeting as cancelled and pushes it. The event stays on the
student's calendar, visibly cancelled, instead of quietly disappearing — a
student who does not open the app that day should still be able to see later
why nothing happened.


## Exams and practice

### See the exams assigned to me

    priority: "critical"

Student opens the Exams tab and sees the exams for the course with their type
and status: which are upcoming and when, which are open now, and which are
finished. Exams the instructor is still drafting are not there.


### Take an exam

    priority: "critical"

Student opens an exam that is currently ongoing and answers its questions —
multiple choice, multiple selection, true/false, essay, short answer, numeric
and fill-in. Progress is kept as they go, so a closed tab or a dead battery does
not cost them the whole paper. Once the exam is no longer ongoing, it stops
accepting submissions.


### Resume an exam I started

    priority: "high"

Student's browser crashes halfway through an exam. They log back in, reopen the
exam and find the answers they had already given, with the remaining time still
counting from where it actually is rather than restarting.


### Practice questions outside an exam

    priority: "high"

Student wants to rehearse before an exam. They answer questions in a practice
session, which records their attempts separately from any graded exam and does
not affect their marks.


### Retry a question

    priority: "low"

Student gets a practice question wrong and wants another go. Their attempts
accumulate rather than overwrite, so they and their instructor can see how the
understanding developed rather than only the final answer.


### See my grades and feedback

    priority: "critical"

Student wants to know how they did. They see, per exam, the grade for each
question, the total, and whatever written feedback the instructor or grading bot
left. A submission still waiting to be graded says so rather than showing a zero.


## Managing my account

### Update my profile

    tested: true
    implemented: true
    priority: "high"
    url: /profile

Student changes their display name, email, GitHub handle or school id. If the
new value is already taken by someone else, the message names which field
collided instead of failing generically. The username is not editable — it is
part of the URL of every course an instructor owns and cannot move.


### Change my password

    tested: true
    implemented: true
    priority: "high"
    url: /profile

Student changes their password, confirming the current one first. A wrong
current password is refused without revealing anything about the stored one.


### Log out everywhere

    tested: true
    implemented: true
    priority: "high"
    url: /profile

Student used a lab machine and forgot to log out. From their profile they end
every session they have anywhere, including the one they are using, and are sent
back to the login page.


### Leave a course

    implemented: true
    priority: "low"

Student enrolled in the wrong course, or dropped it for real. They leave it
themselves and it disappears from their course list. They cannot drop anyone
else, and leaving does not destroy the work they already submitted — an
instructor who re-enrolls them restores access to it.
