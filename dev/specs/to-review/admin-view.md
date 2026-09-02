# Admin view (MVP)

## Scope

Three things, and nothing else:

1. Invite instructors.
2. Tables of users, courses, disciplines, and editions — read-only except for
   the two catalogs admins own outright, disciplines and editions.
3. A short list of system-wide actions an admin cannot perform anywhere else.

Deliberately out of scope, each for a stated reason:

| Not in this spec | Why |
| :--- | :--- |
| Editing course content | Admins have no authority over content at all (`FR-ACC-010`) |
| Editing course records | Instructors own their courses; admins see them and archive them |
| Archiving courses | Needs `Course.archivedAt` (`FR-CRS-024`) |
| Changing a user's role | `userService.update` accepts `UpdateProfile`, which has no `role`, on purpose |
| Deleting users | Cascades into submissions and grades; needs a retention decision (`FR-NFR-040`) |

Requirements covered: `FR-ACC-001`, `FR-ACC-002`, `FR-ACC-011`, `FR-CRS-001`,
`FR-CRS-003`, `FR-CRS-010`, `FR-CRS-011`, `FR-CRS-012`.

## Design decisions

### `/admin` becomes a tabbed section, mirroring `/design`

`src/pages/admin/index.astro` is currently the users table. It becomes:

```
/admin              overview: counts and the action panel
/admin/users        every account
/admin/courses      every course
/admin/disciplines  every discipline, with create and rename
/admin/editions     every edition, with create and window editing
```

A new `AdminLayout.astro` carries the tab strip, copying `DesignLayout`'s
`role="tablist"` markup rather than inventing a second navigation pattern. The
existing users table moves to `/admin/users` unchanged.

### The access check moves into middleware

Today the guard is two lines at the top of the page:

```ts
if (!Astro.locals.user) return Astro.redirect("/login");
if (!canManageUsers(Astro.locals.user)) return Astro.redirect("/403");
```

That is fine for one page and a liability for five, because the failure mode of
forgetting it is an open admin page that looks correct. A new
`src/middleware/admin.ts` matches `/admin` and everything under it, redirecting
anonymous visitors to `/login` and authenticated non-admins to `/403`. It uses
the same `canManageUsers` predicate, so the rule still lives in
`auth/permissions.ts` and the middleware only applies it.

Pages keep working without their own guard, and a new admin page is protected by
existing at that path.

### Registering an instructor means inviting one

There is no "create account" form. `canCreateUser` returns true only for
`SYSTEM`, and `FR-ACC-001` makes invite redemption the sole path to an account —
the invitee sets their own password and supplies their own `githubId` and
`schoolId`, none of which an admin can type for them honestly.

So the admin form creates a `PERSONAL` invite with `role: INSTRUCTOR`, which
`canInvite` already permits for admins, through the existing
`auth.createPersonalInvite` action. No new action, no new service method.

Since nothing sends email (notifications are a deferred non-goal, `00-overview.md`), the generated link
is displayed once with a copy button, exactly as the classroom-invite flow
already does. The emergency path for a locked-out instance stays
`manage create-user`.

### `InviteService` gets the full CRUD set, not just what this page needs

`InviteService` has `create`, `findOne` (by raw token), and `redeem`. An admin
who closes the tab before copying the link currently has no way to see that the
invite exists, and no way to withdraw it.

The page needs `findMany` and `delete`. The service gets `update` as well,
because these classes are what the REST API exposes as resources and a method
missing here is an endpoint missing later:

```ts
interface FindInvitesBy { createdById?: number; kind?: InviteKind; pending?: boolean }
interface UpdateInviteInput { expiresAt?: Date; maxUses?: number | null }

class InviteService implements
  FindManyAs<FindInvitesBy, InviteWithCount>,
  UpdateAs<{ id: number }, UpdateInviteInput, InviteWithCount>,
  DeleteAs<{ id: number }> { … }
```

`update` covers the two fields that can change without rewriting the invite's
meaning: extending an expiry, and raising or lifting `maxUses` on a classroom
code. `kind`, `role`, and `email` stay immutable — they are the contract the
redeemer accepts, and changing them under an outstanding link silently changes
what that link grants.

The permission pair lives in `auth/permissions.ts` — `canViewInvite(actor,
invite)` and `inviteVisibility(actor)`, written adjacent and pinned by an
agreement test, per `docs/design/service-access-control.md` — and governs all
four methods. The rule: admins see every invite, instructors see the ones they
created, students see none.

**The token is not recoverable.** Only `tokenHash` is stored, so the listing
shows metadata — email, role, expiry, uses, who created it — and never the link.
An admin who loses a link revokes the invite and issues a new one. The UI must
say so, or the first admin to lose a link will assume the feature is broken.

### `DisciplineService` gets the rest of its CRUD set

`DisciplineService` implements `findMany` and `create`. The admin catalog needs
`findOne` for a detail lookup, `update` to fix a name, and `delete` to remove a
slug created by mistake — and the same reason applies as for invites: these
classes are the REST API's resources.

```ts
class DisciplineService implements
  FindOne<{ slug: string }, Discipline>,
  FindMany<FindDisciplinesBy, Discipline>,
  CreateAs<CreateDiscipline, Discipline>,
  UpdateAs<{ slug: string }, { name: string }, Discipline>,
  DeleteAs<{ slug: string }> { … }
```

`update` takes the display name only. The slug is immutable for the same reason
an edition's is: it is the first segment of every course URL underneath it, and
changing it would move those courses without touching a row.

`delete` refuses a discipline that still has courses or questions, naming the
count, rather than letting the foreign key raise.

`canCreateDiscipline` becomes `canManageDisciplines`, matching
`canManageEditions` — one predicate for all three writes, since the rule is the
same for each.

### Editions reuse what the editions slice built

`/admin/editions` lists `editionService.findMany({})` with the window and a
live/closed badge, and offers create, rename, and window editing through
`editionService.create` and `update`. Nothing new in the service layer; the
slice that added the table already implemented the full set.

Deleting an edition is offered but refuses while courses reference it — the
service already returns a message naming the count, which the form shows
verbatim.

### The tables are unpaginated, and that is a decision with an expiry date

`userService.findMany({}, { actor })` and `courseService.findMany({}, { actor })`
already return everything an admin may see, which is everything. At the scale in
`08-nonfunctional.md` — one institution, courses of up to 250 students — the
user table is the only one that grows without bound, and it grows by one row per
person per institution.

No pagination, no server-side search, one client-side filter input over the
already-loaded rows. This stops being reasonable somewhere around a few thousand
users; the follow-up section names it rather than pretending otherwise.

Courses show discipline, edition, instructor, active headcount (`_count`
already comes back with `CourseWithDetails`), term dates, and a link to the
course URL built with `courseHref`.

### The action panel

Five actions on `/admin`, the destructive ones behind a confirm dialog:

| Action | Implementation | New? |
| :--- | :--- | :--- |
| Invite an instructor | `auth.createPersonalInvite` | no |
| Create a discipline | `admin.createDiscipline` → `disciplineService.create` | new action, existing service |
| Create an edition | `admin.createEdition` → `editionService.create` | new action, existing service |
| Revoke an invite | `admin.revokeInvite` → `inviteService.delete` | new action, new service method |
| Log a user out everywhere | `admin.forceLogout` → `sessionService.delete({ userId })` | new action, existing service |

`disciplineService.create` already rejects reserved and malformed slugs, and its
thrown message names the constraint — surface that text in the form rather than
replacing it with a generic failure, since "`design` is a reserved name" is the
whole content of the error.

Force-logout exists because `canManageSessions` already grants it to admins and
it is the only lever an admin has when an account is compromised. It does not
disable the account; that needs a column and belongs in the follow-up.

## Schema

None. Editions landed with their own slice; course archival is excluded
precisely because it would need a column.

## Tests

Service specs:

- `inviteService.findMany` returns every invite for an admin, only self-created
  ones for an instructor, and none for a student.
- The agreement test: over one fixture set, `findMany` returns exactly the
  invites for which `canViewInvite` is true.
- `inviteService.delete` throws `ForbiddenError` for an instructor deleting
  someone else's invite, and succeeds for its creator and for an admin.
- `inviteService.update` extends an expiry and lifts `maxUses`, refuses to touch
  `kind`, `role`, or `email`, and obeys the same visibility rule as `delete`.
- `disciplineService.create` surfaces a message naming the reserved slug.
- `disciplineService.update` renames a discipline, rejects a non-admin, and has
  no path that changes a slug.
- `disciplineService.delete` throws while a course uses the discipline and
  succeeds once none do.

Playwright:

- An admin sees all five tabs, and the counts on `/admin` match the seeded data.
- An instructor gets `/403` on `/admin`, `/admin/users`, `/admin/courses`,
  `/admin/disciplines`, and `/admin/editions` — every route, not just the index,
  since the point of the middleware is that no page can opt out.
- An anonymous visitor is redirected to `/login`.
- Inviting an instructor shows a link once, and the invite appears in the
  listing with `0` uses; revoking it removes the row.
- Creating a discipline named `login` fails with the reserved-name message;
  creating `cs102` succeeds and it appears in the table.
- Creating an edition with a malformed slug fails; a valid one appears in the
  table with the right live/closed badge for its window.
- Force-logout on a user with a live session sends that session's next request
  to `/login`.

Screenshots of `/admin`, `/admin/users`, `/admin/courses`, and
`/admin/disciplines` go to the human before this is called done.

## Follow-up, not in this spec

- "Archive finished courses", once `Course` has the column (`FR-CRS-024`).
- Suspending an account without deleting it — the missing half of force-logout.
- Promoting an instructor to admin. Needs a deliberate `role` mutation path,
  kept out of `UpdateProfile`.
- Pagination and server-side search on `/admin/users`.
- An audit trail. Nothing currently records that an admin revoked an invite or
  logged someone out, and the actions above are exactly the ones worth logging.
