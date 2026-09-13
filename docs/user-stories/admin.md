# Admin user stories

In all following stories, you are an admin. Admins see and manage everything,
with one deliberate exception: authority over a course's contents and its roster
belongs to the instructor who owns it, so a non-owning admin can see that a
course exists without being able to teach it.

Some of these stories belong to the sysadmin, who runs the instance, its database
and its backups. Codehood has no sysadmin role, but the job exists on any real
deployment and the work is done from the command line.


## Bootstrapping the instance

### Create the first admin

    status: cli

A freshly deployed instance has no users at all, and accounts only come into
existence through invites, so there is nobody to issue the first one. Sysadmin
creates the first admin account from the command line, outside the app.


### Check that the instance is healthy

    status: implemented
    url: /api/health

Sysadmin, or an uptime monitor, needs to know whether the server is up and can
reach its database, without holding an account or a session.


### Read the API documentation

    status: implemented
    url: /api/docs

Admin is wiring up a bot or debugging a CLI push and needs to know what the REST
API accepts. The documentation is generated from the same schemas the endpoints
validate against, so it cannot drift from the implementation.


## Managing users

### Create a user account directly

    status: todo

Admin has someone who needs an account now and cannot wait on an invite round
trip. Knowing their email, name and desired username, the admin creates the
account with whatever role it needs, either from the admin panel or from the CLI
on the server.


### Invite an instructor

    status: implemented
    url: /admin

Admin knows the email of each new instructor and issues a personal invite for
each one, then mails the links out. An instructor who has no account yet gets one
by redeeming the link. When an invite goes to the wrong address, or the candidate
turns the post down, the admin revokes it and the link stops working, while
accounts already created from it are untouched.


### See every invite that is outstanding

    status: implemented
    url: /admin

Admin wants to know who has been invited and has not accepted yet, who issued
each invite, and how many times a classroom link has been used. The invite token
itself is never shown, since only its hash is stored, so a lost link is reissued
rather than recovered.


### Reset a password for someone locked out

    status: cli

An instructor lost their password and this instance has no email delivery
configured. Sysadmin resets it from the command line and tells them out of band.


### Find a user and end their sessions

    status: implemented
    url: /admin/users

Admin has a name, an email or a school id and needs the account behind it, to
check its role or to act on it. When the account may be compromised, or its owner
left the institution, they end every session it holds anywhere. The account still
exists, it just cannot act until somebody logs in again.


## Disciplines and editions

### Create a discipline

    status: implemented
    url: /admin/disciplines

Admin registers a subject that will be taught, giving it a slug like `cs101`. The
discipline outlives the courses that instantiate it and owns the question bank
shared across them.

Slugs like `login` or `admin` are refused with an explanation, because course
URLs live in the root namespace and such a slug would silently make every course
under it unreachable instead of erroring. When the department renames the subject
the admin updates its display name, and the slug stays put, since it is part of
the URL of every course that ever ran under it.


### Create an edition

    status: implemented
    url: /admin/editions

Admin opens a new academic term, such as `2026-1`, with a window saying when
courses may be created for it, and instructors can then create their courses for
that term. Closing the window when the term is over stops new courses being
created for that edition. The courses already running in it carry on untouched
and their URLs keep working after the term ends.


### Delete an edition or discipline created by mistake

    status: implemented

Admin fat-fingered a slug and removes the empty edition or discipline. One that
already has courses hanging off it is not silently destroyed along with them.


## Overseeing courses

### See every course in the system

    status: implemented
    url: /admin/courses

Admin wants an inventory: which courses exist, who teaches each one, which
discipline and edition they belong to, and how many students are enrolled.
Instructors have no catalog, so this view is the only place the whole picture
exists.

Opening one to check a complaint about its material, the admin can read it but
cannot manage its roster or write its contents. That authority belongs to the
instructor who owns the course, and there is no admin branch around it.


### Reassign or retire a course

    status: todo

An instructor leaves mid-term and someone else takes the course over. Admin needs
a way to hand it to the new instructor, bearing in mind that the instructor's
username is part of the course URL.


## Operations

### Import a term's calendar for an instructor

    status: cli

An instructor cannot or will not use the CLI. Sysadmin imports the term's
calendar and resources on their behalf from the command line, going through the
same services the API does.


### Audit what a bot is doing

    status: todo

Admin wants to know which API keys exist, who owns them and when each was last
used, so a key nobody remembers issuing can be found and revoked. A grading bot
currently acts as the instructor who issued its key, and narrowing that is open
work.


### Back up and restore the instance

    status: todo

Sysadmin needs a copy of the database and the resource blobs that can be restored
onto a fresh instance. Content is reproducible from the instructors'
repositories, but enrollments, submissions and grades are not.
