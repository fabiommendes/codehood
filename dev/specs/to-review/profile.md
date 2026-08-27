# User profile page

## Scope

A self-service `/profile` page for the logged-in user only — no admin view of
other users' profiles (that's a separate future feature). Builds entirely on
existing auth infrastructure (`docs/implemented/auth.md`); no schema changes.

## Design decisions

### Editable fields: name, email, githubId, schoolId

All four are plain text inputs, pre-filled, submitted as one form. Email,
githubId, and schoolId are all `@unique` in the schema — a collision
surfaces as a Prisma P2002 error, which the action catches and turns into a
field-specific message ("That email is already in use.") rather than a raw
500.

No re-verification step on email change (no email sending exists yet — see
`docs/implemented/auth.md`'s deferred list). This is a deliberate
simplification: the change takes effect immediately, same trust model as
everything else in this roll-your-own system.

### Username is not editable

`username` is shown on the form as a disabled, read-only field — it is set
once at invite acceptance and never changes after that. `Course.instructor`
targets `User.username` as its foreign key (see
`docs/design/url-structure.md`), so a username change would silently move
every course that instructor owns to a new URL. `userService.update` also rejects any `username` key in its `fields`
argument at runtime, so the immutability holds even for a caller that
bypasses the `UpdateProfile` type.

### Password change is a separate form, requires the current password

Standard pattern: current password + new password (min 8 chars, matching
the invite-accept flow), verified against the stored hash before calling
`userService.updatePassword`. Kept separate from the profile-fields form so
a stray click can't change a password accidentally.

### "Log out everywhere"

Small addition using `sessionService.revokeAllForUser`, which already
existed but had no caller. Revokes all sessions for the user (including the
current one), then clears the current session cookie explicitly — the
session row is gone either way, but leaving a dangling cookie around is
sloppy.

### API keys: reuse existing actions, add a listing

`apiKeyService.listForUser` and the `createApiKey`/`revokeApiKey` actions
already exist (built for the CLI/bot use case, never wired to any UI). The
profile page is that UI: list existing keys (name, kind, created, last
used — never the raw key again), a small form to create a new one (name +
kind), and the raw token shown once in the action result immediately after
creation. `createApiKey` and `revokeApiKey` are missing `accept: "form"`
(same gap `login`/`logout`/`acceptInvite` had — see auth.md) since nothing
called them from an HTML form before; fixing that here.

### Shared `requireUser` helper

`requireUser` existed as a private, unexported function inside
`src/actions/auth.ts`. Extracted to `src/auth/require-user.ts` so
`src/actions/profile.ts` doesn't duplicate it.

## Out of scope for v1

- Avatar/image upload (`User.image` stays unset — no file storage exists).
- Email verification on change.
- Admin-facing view/edit of other users' profiles.
- Per-session listing (only "log out everywhere", not "log out this one
  device").
