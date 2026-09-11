# Admin user stories

In all following stories, you are an admin user. Admin users have broad
management access to the system. The admin can also be the **sysadmin**, which
is responsible for managing the running instance, the database, etc. Codehood do
not have the concept of a sysadmin role, but it is a common use case.

Admins see and manage everything, with one deliberate exception: authority over
a course's contents and its roster belongs to the instructor who owns it, so a
non-owning admin can see that a course exists without being able to teach it.


## Bootstrapping the instance

### Create the first admin

    implemented: "cli"
    priority: "critical"

A freshly deployed instance has no users at all, and accounts only come into
existence through invites — so there is nobody to issue the first one. Sysadmin
creates the first admin account from the command line, outside the app.


### Check that the instance is healthy

    implemented: true
    priority: "low"
    url: /api/health

Sysadmin, or an uptime monitor, needs to know whether the server is up and can
reach its database, without holding an account or a session.


### Read the API documentation

    implemented: true
    priority: "low"
    url: /api/docs

Admin is wiring up a bot or debugging a CLI push and needs to know what the REST
API actually accepts. The documentation is generated from the same schemas the
endpoints validate against, so it cannot drift from the implementation.


## Managing users

### Add a new user via admin panel

    priority: "high"

Admin needs to add a new user to the system. The user can be another admin,
an instructor or a student. The admin knows basic information like email, name
and desired username.


### Add a new user via CLI

    priority: "low"

Admin needs to add a new user to the system using the codehood CLI.


### Create personalized invites

    tested: true
    priority: "high"

Admin needs to create personalized invites for new instructors. Admin knows the
email of each instructor and can e-mail back personalized invite links to each
of them. The instructor should be able to redeem those links to create their
account, if they don't have one yet. 


### Revoke an invite that has not been redeemed

    implemented: true
    priority: "high"
    url: /admin

Admin issued an invite to the wrong address, or an instructor turned the post
down. They revoke the invite and the link stops working. Accounts already
created from it are untouched.


### See every invite that is outstanding

    implemented: true
    priority: "low"
    url: /admin

Admin wants to know who has been invited and has not accepted yet, who issued
each invite, and how many times a classroom link has been used. The invite token
itself is never shown — only its hash is stored, so a lost link is reissued
rather than recovered.


### Reset a password for someone locked out

    implemented: "cli"
    priority: "high"

An instructor lost their password and there is no email delivery configured on
this instance. Sysadmin resets it from the command line and tells them out of
band.


### Force a user to log out everywhere

    implemented: true
    priority: "high"
    url: /admin/users

Admin learns that an account may be compromised, or that someone left the
institution. They end every session that user holds anywhere. The account still
exists; it just cannot act until somebody logs in again.


### Find a user

    implemented: true
    priority: "low"
    url: /admin/users

Admin has a name, an email or a school id and needs the corresponding account —
to check its role, or to act on it.


## Disciplines and editions

### Create a discipline

    tested: true
    implemented: true
    priority: "critical"
    url: /admin/disciplines

Admin registers a subject that will be taught, giving it a slug like `cs101`.
The discipline outlives the courses that instantiate it and owns the question
bank shared across them.


### Be stopped from using a reserved slug

    implemented: true
    priority: "high"
    url: /admin/disciplines

Admin tries to create a discipline named `login` or `admin`. Course URLs live in
the root namespace, so such a slug would silently make every course under it
unreachable rather than erroring. The attempt is refused with an explanation.


### Rename a discipline

    implemented: true
    priority: "low"
    url: /admin/disciplines

The subject is renamed by the department. Admin updates its display name. The
slug does not change, because it is part of the URL of every course that ever
ran under it.


### Create an edition

    implemented: true
    priority: "critical"
    url: /admin/editions

Admin opens a new academic term, such as `2026-1`, with a window saying when
courses may be created for it. Instructors can then create their courses for
that term.


### Close an edition without breaking its courses

    implemented: true
    priority: "high"
    url: /admin/editions

The enrollment window for a term is over. Admin closes it, which stops new
courses being created for that edition. The courses already running in it carry
on untouched, and their URLs keep working after the term ends.


### Delete an edition or discipline that was created by mistake

    implemented: true
    priority: "low"

Admin fat-fingered a slug. They remove the empty edition or discipline. One that
already has courses hanging off it is not silently destroyed along with them.


## Overseeing courses

### See every course in the system

    implemented: true
    priority: "high"
    url: /admin/courses

Admin wants an inventory: which courses exist, who teaches each one, which
discipline and edition they belong to, and how many students are enrolled.
Instructors have no catalog, so this view is the only place the whole picture
exists.


### Look at a course I do not teach

    implemented: true
    priority: "low"

Admin opens a course to check a complaint about its material. They can read it,
but they cannot manage its roster or write its contents — that authority belongs
to the instructor who owns the course, and there is no admin branch around it.


### Reassign or retire a course

    priority: "low"

An instructor leaves mid-term and someone else takes the course over. Admin
needs a way to hand it to the new instructor, bearing in mind that the
instructor's username is part of the course URL.


## Operations

### Import a term's calendar for an instructor

    implemented: "cli"
    priority: "low"

An instructor cannot or will not use the CLI. Sysadmin imports the term's
calendar and resources on their behalf from the command line, going through the
same services the API does.


### Audit what a bot is doing

    priority: "low"

Admin wants to know which API keys exist, who owns them and when each was last
used, so a key nobody remembers issuing can be found and revoked. A grading bot
currently acts as the instructor who issued its key, and narrowing that is open
work.


### Back up and restore the instance

    priority: "high"

Sysadmin needs a copy of the database and the resource blobs that can be
restored onto a fresh instance. Content is reproducible from the instructors'
repositories, but enrollments, submissions and grades are not.
