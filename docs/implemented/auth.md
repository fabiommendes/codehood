# Auth (roll-your-own)

## Requirements

- 3 consumers of auth: 
  - browser sessions (students, instructors and admins).
  - CLI requests to REST API.
  - Grading bots via REST API. Bots can be tied to either instructors or admins.
- Invite-only. No public sign-up form. An instructor invites students. Admins
  invite instructors. Admins are created manually via a command; the invitee
  sets their own password when accepting.
- No email sending yet. Invite links must be shareable out-of-band (copy the
  URL and send it however the inviter likes). E-mail should define an interface
  which can be implemented later with a provider of choice.
- Simple, no external auth dependency.

## Design decisions

### Password hashing: Argon2id

Use [`@node-rs/argon2`](https://github.com/napi-rs/node-rs) — prebuilt native
(napi) bindings, no compiler toolchain required at install time, actively
maintained. Argon2id is the current OWASP-recommended default over scrypt.

Parameters (OWASP baseline, tune once we have real hardware numbers):
`memoryCost=19456` (19 MiB), `timeCost=2`, `parallelism=1`. The library's
output already encodes algorithm + parameters + salt in one string (PHC
format), so `User.passwordHash` just stores that string as-is — no custom
tagging needed, and parameters can change later without invalidating
existing hashes (verify reads the params back out of the stored string).

### Sessions: opaque token in an httpOnly cookie, hashed at rest

Not JWT — JWTs can't be revoked without extra bookkeeping, and we don't need
stateless verification here. On login, generate a 256-bit random token, send
the raw token to the browser as an httpOnly/secure/`SameSite=Lax` cookie,
store only `sha256(token)` in the `Session` table. Lookup is a hash + indexed
query. Sliding expiry: 30 days, refreshed when more than half expired (avoids
writing to the DB on every request).

### CLI auth: separate API keys, not sessions

The CLI is a long-lived, non-browser client — cookies don't fit. An
instructor runs `codehood login`, which does a normal username/password
exchange against a dedicated endpoint and receives an API key (shown once).
The key is sent as `Authorization: Bearer <key>` on REST calls. Stored
hashed (same sha256-at-rest approach as sessions) in an `ApiKey` table, one
row per issued key, revocable individually, with `lastUsedAt` for visibility.

### Invites: personal (single-use) and classroom (multi-use join code)

Two invite *kinds* sharing one `Invite` table (`InviteKind`: `PERSONAL` |
`CLASSROOM`):

- **Personal** — instructor→student or admin→instructor. Targets one email,
  `maxUses` fixed at 1, `role` fixed. The invitee must accept with the exact
  invited email.
- **Classroom** — instructor generates a reusable join code/link for a
  course. `email` is null (anyone with the link can redeem it), `role` fixed
  to `STUDENT`, `maxUses` is nullable (null = unlimited) so the instructor
  can cap enrollment or leave it open.

Redemptions are tracked in a separate `InviteRedemption` row per user rather
than a single `usedAt` on `Invite`, since a classroom invite can be redeemed
by many users. `InviteRedemption.userId` is unique — a user redeems at most
one invite. Redeeming checks `redemptions.length < maxUses` (personal
invites are just the `maxUses = 1` case, so no kind-specific redemption
logic is needed — only the "does the submitted email match" check differs by
kind).

Accepting = visiting `/invite/[token]`, setting a password and providing
`githubId`/`schoolId` (required for both `STUDENT` and `INSTRUCTOR`,
regardless of invite kind — see below), which creates the `User` and inserts
the `InviteRedemption`. No email is sent by the system; the inviter copies
the generated link from the UI.

### `githubId` / `schoolId`: real handles, not OAuth

Neither field is populated by an OAuth flow — `githubId` is just the
person's GitHub username, collected as a required form field when a student
or instructor accepts their invite (assumption: everyone has one, used for
sharing/collaborating on code). `schoolId` is the institution's student/staff
id, collected the same way.

Both stay `String @unique` (not nullable) on `User` — but for `ADMIN`
accounts, which don't need either, the user-creation service defaults
unfilled values to `` @<local-part-of-email> `` (e.g. `admin@codehood.local`
→ `@admin`). The leading `@` can't collide with a real GitHub username or a
real school id, so uniqueness holds without special-casing admins in the
schema. Students/instructors do not get this default — their invite-accept
form requires real values.

### Bootstrapping the first account

Nothing can invite the first admin. Three ways in, all sharing one
`ensureDevAdmin()` function (`src/auth/bootstrap.ts`) so the logic and the
`admin@codehood.local` / `admin` credentials live in exactly one place:

- **`pnpm seed`** (`prisma db seed`, running `prisma/seed.ts`) — the
  standard, explicit way to seed a fresh dev database. Idempotent: skips if
  any `User` row already exists.
- **Dev server self-heal**: the same function runs on the first request via
  `devBootstrapMiddleware` (`src/middleware.ts`), so `astro dev` works even
  if the seed was never run manually.
- **Everywhere else**: the `manage create-user` and `manage reset-password`
  commands from `docs/design/management-commands.md` (Commander.js, under
  `src/commands/`), going through `UserService` like everything else.

`ensureDevAdmin()` is gated on `process.env.NODE_ENV === "production"` — in
production it's a no-op (logs and returns) in every call path, so the
default admin account only ever exists in dev.


### Roles

`Role` enum on `User`: `ADMIN`, `INSTRUCTOR`, `STUDENT`. Permission checks
(e.g. "can this user manage this course") live in `src/auth/permissions.ts`,
not scattered across actions/API handlers — actions/handlers call into it.

## Schema (prisma/schema.prisma)

```prisma
enum Role {
  ADMIN
  INSTRUCTOR
  STUDENT
}

model User {
  id           Int       @id @default(autoincrement())
  publicId     String    @unique
  email        String    @unique
  schoolId     String    @unique
  githubId     String    @unique
  name         String
  passwordHash String
  role         Role
  image        String?

  createdAt    DateTime  @default(now())
  sessions     Session[]
  apiKeys      ApiKey[]
  invitesSent  Invite[]  @relation("InviteCreatedBy")
  redemption   InviteRedemption?
}

model Session {
  id           Int      @id @default(autoincrement())
  tokenHash    String   @unique
  userId       Int
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt    DateTime
  createdAt    DateTime @default(now())
}

enum ApiKeyKind {
  CLI
  BOT
}

model ApiKey {
  id         Int        @id @default(autoincrement())
  keyHash    String     @unique
  name       String
  kind       ApiKeyKind
  userId     Int
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastUsedAt DateTime?
  createdAt  DateTime   @default(now())
}

enum InviteKind {
  PERSONAL
  CLASSROOM
}

model Invite {
  id          Int                @id @default(autoincrement())
  tokenHash   String             @unique
  kind        InviteKind
  email       String?            // required for PERSONAL, null for CLASSROOM
  role        Role
  courseId    Int?
  maxUses     Int?               // PERSONAL: always 1. CLASSROOM: null = unlimited
  expiresAt   DateTime
  createdById Int
  createdBy   User               @relation("InviteCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime           @default(now())
  redemptions InviteRedemption[]
}

model InviteRedemption {
  id         Int      @id @default(autoincrement())
  inviteId   Int
  invite     Invite   @relation(fields: [inviteId], references: [id], onDelete: Cascade)
  userId     Int      @unique
  user       User     @relation(fields: [userId], references: [id])
  redeemedAt DateTime @default(now())
}
```

## Code layout

| Path                              | Responsibility                                                                                    |
| :--------------------------------- | :------------------------------------------------------------------------------------------------ |
| `src/db/user.service.ts`           | CRUD for `User`, including the `@<local-part>` default for admin `githubId`/`schoolId`.           |
| `src/db/session.service.ts`        | Create/lookup/revoke sessions.                                                                    |
| `src/db/api-key.service.ts`        | Issue/lookup/revoke API keys (CLI and BOT kinds).                                                 |
| `src/db/invite.service.ts`         | Create/lookup/redeem invites (both kinds), create redemptions.                                    |
| `src/auth/password.ts`             | Argon2id hash + verify (`@node-rs/argon2`).                                                       |
| `src/auth/token.ts`                | Random token generation + sha256 hashing helper (shared by sessions/keys/invites).                |
| `src/auth/permissions.ts`          | Role/ownership checks used by actions and API handlers.                                           |
| `src/auth/email.ts`                | `EmailSender` interface + a no-op/console-log implementation (logs the link instead of sending). |
| `src/middleware/session.ts`        | Reads session cookie, attaches `context.locals.user`, refreshes sliding expiry.                   |
| `src/middleware/api-key.ts`        | Reads `Authorization: Bearer`, attaches `context.locals.user` for REST routes under `src/api/`.   |
| `src/actions/auth.ts`              | Astro Actions: `login`, `logout`, `acceptInvite`, `createInvite`, `createApiKey`, `revokeApiKey`. |
| `src/commands/create-user.ts`      | `manage create-user` (see `docs/design/management-commands.md`).                                  |
| `src/commands/reset-password.ts`   | `manage reset-password`.                                                                          |
| `src/pages/login.astro`            | Login form.                                                                                       |
| `src/pages/invite/[token].astro`   | Accept-invite / set-password form (branches on invite kind).                                      |

## Out of scope for v1 (explicitly deferred)

- User profile (bio, avatar, website, gender, ...) — split into its own spec
  (`docs/specs/user-profile.md`), separate migration.
- Email-based password reset (needs email sending — separate spec once we
  pick a provider; `src/auth/email.ts` interface exists so this slots in
  later without touching callers).
- OAuth/social login (`githubId` is a plain user-entered handle, not an
  OAuth-linked identity — see above).
- 2FA.
- Scoped/restricted permissions for `BOT` API keys — for now a bot key has
  the same permissions as its owning user; `ApiKey.kind` exists so scoping
  can be added later without a schema change to distinguish bots from CLI
  keys retroactively.
- Rate limiting on login (worth adding before this is internet-facing with
  real users; tracked as a follow-up issue, not blocking v1).

## Open questions I'm resolving by default, flag if wrong

- Session cookie lifetime (30d sliding) and Argon2id cost parameters are
  reasonable defaults, not requirements — easy to tune later without a
  schema change.
- Classroom `maxUses` defaults to unlimited (null) unless the instructor
  sets a cap when generating the join code.
