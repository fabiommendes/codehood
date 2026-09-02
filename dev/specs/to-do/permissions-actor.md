# A typed actor for the permission system

`Actor` is `AuthUser | typeof SYSTEM` today — an `{ id, role }` pair or a
symbol. It says who a call acts as and nothing about how they got here, so every
rule the requirements draw around *credentials* rather than people is currently
unenforceable.

The gap is not theoretical. `apiKeyMiddleware` authenticates a key and then
writes `locals.user = { id: apiKey.user.id, role: apiKey.user.role }`. From that
line onward a `BOT` key is indistinguishable from its owner sitting at a
browser, and FR-ACC-023 — "a `BOT` key MUST NOT create or modify questions,
exams, calendar events, resources, courses, or enrollments" — has nothing left
to check. `locals.apiKey` carries the kind and no code reads it.

This refactor gives the actor a kind and a credential identity, so the rules in
FR-ACC-022, FR-ACC-023, and FR-SYNC-040 become expressible.

## Scope

- `Actor` becomes a discriminated union in `src/db/base-service.ts`, carrying
  `kind` and `authenticationKey`.
- `ApiKey` gains `publicId`, so a key has a name that is safe to hold.
- `credentialAllows` in `src/auth/permissions.ts`: the write ceiling per kind,
  which is FR-ACC-022's table as code.
- Every existing predicate moves from `actor === SYSTEM` to the new narrowing,
  and the content and operation predicates gain their credential check.
- `locals.actor` replaces the `locals.user` / `locals.apiKey` pair; the three
  middlewares build it.
- The `manage` commands, seeds, and tests that pass `SYSTEM` or `FULL_ACCESS`
  keep working unchanged.

Out of scope: the REST endpoints that would exercise a `CLI` key (the sync spec
builds those), the grading endpoints a `BOT` key writes through
(`06-grading.md`), and any audit log — this makes one possible, and does not
build it.

## Design decisions

### The actor is a union discriminated by `kind`

```ts
export type ActorKind = "USER" | "CLI" | "BOT" | "SYSTEM";

interface CredentialedActor {
  /** The `User` this actor acts as. For a key, its owner — FR-ACC-024. */
  readonly id: number;
  readonly role: Role;
  readonly authenticationKey: string;
}

export interface UserActor   extends CredentialedActor { readonly kind: "USER" }
export interface CliActor    extends CredentialedActor { readonly kind: "CLI" }
export interface BotActor    extends CredentialedActor { readonly kind: "BOT" }
export interface SystemActor { readonly kind: "SYSTEM"; readonly authenticationKey: "system" }

export type Actor = UserActor | CliActor | BotActor | SystemActor;
```

`id` and `role` still mean what they mean today: the person this call acts as. A
key acts as its owner and never sees more (FR-ACC-024), so a `BotActor` carries
the owner's id, and narrowing happens through `kind` rather than through a
different id.

**`SystemActor` deliberately has no `id` and no `role`.** Today every predicate
opens with `actor === SYSTEM || …` by convention, and a predicate that forgets
reads `SYSTEM.id`, which is `undefined`, and quietly denies. With `id` absent
from that member of the union, `actor.id` does not compile until the system case
is handled, so the convention becomes a compiler rule. It also enumerates the
migration: the type error list *is* the list of call sites to update.

### Four kinds, not two

The request named two, `User` and `Bot`. This spec ships four, and the extra two
are load-bearing:

`SYSTEM` has to stay a kind because it is already an actor and already bypasses
every rule (FR-ACC-012). Folding it in makes the union total, so there is no
second axis to check.

`CLI` has to be distinct from `USER` because FR-ACC-022 gives them different
write surfaces, and `00-overview.md`'s actor table says so in prose:
"Instructor | Web app + CLI | **Own courses: content via CLI, operations via
web**". A `CLI` key may push questions, exams, calendar events, and resources.
It may not grant extra exam time (FR-EXAM-022, web-app-only), transition an exam
(FR-EXAM-002), drop a student, or issue an invite. Collapsing `CLI` into `USER`
would leave those writable by anyone holding a key that was only ever meant to
push a repository.

If that is the wrong call, collapsing them is a one-line change: drop `CLI` from
`ActorKind` and map a CLI key to `USER` in the middleware. Everything else in
this spec is unaffected.

### `authenticationKey` is the credential's public name, never the credential

For a `USER`, it is the **username** — stable, immutable (FR-ACC-004), and
already the thing that names a person everywhere else in the system.

For a `CLI` or `BOT` actor, it is the key's `publicId`, **not the key**. This is
the one place this spec contradicts the request as stated, and the reason is
FR-NFR-042: API keys are stored as SHA-256 hashes and are "never recoverable".
The plaintext key exists in exactly one place — the `Authorization` header of
the request being authenticated — and putting it on the actor would carry it
into every service call, every thrown `ForbiddenError`, every log line that
prints an actor, and every crash report. A credential that appears in a log is a
credential that has to be rotated.

`keyHash` is the obvious alternative and is rejected for the same reason at one
remove: it is what the database compares against, so a leaked hash is a lookup
away from impersonation being detectable-but-real, and it has no business in an
error message either.

So `ApiKey` gains a `publicId` — a nanoid, exactly the convention the codebase
already uses for "an identifier that appears outside the row but should not be
guessable" (`User.publicId`, `Group.publicId`). It is safe to log, safe to show
on `/profile` next to the key's name, stable for the key's lifetime, and it
tells an operator reading an audit line *which* key did something, which the
username alone never could when an instructor holds three.

The pair `(kind, authenticationKey)` is the identity. The strings are not
prefixed or namespaced, because `kind` is always present alongside — but nothing
should ever compare `authenticationKey` without also comparing `kind`.

### `SYSTEM` stays unforgeable

The current comment on `SYSTEM` earns its keep: a symbol "can never arrive by
accident from parsed JSON or a forgotten variable". A plain object with
`kind: "SYSTEM"` can.

```ts
export const SYSTEM: SystemActor = Object.freeze({ kind: "SYSTEM", authenticationKey: "system" });

/** Reference identity, not a `kind` comparison: a forged object fails this. */
export function isSystem(actor: Actor): actor is SystemActor {
  return actor === SYSTEM;
}
```

Every predicate uses `isSystem(actor)`, never `actor.kind === "SYSTEM"`. An
object deserialized from a request body with `kind: "SYSTEM"` therefore fails
the guard, falls through to the credentialed branches, has no `id` to match, and
is denied. Fail-closed, with a test that says so.

`kind` stays on the type for narrowing and for logs; identity is by reference.

### The credential is a ceiling, applied after the ownership rule

FR-ACC-022 is a table, so it becomes one:

```ts
export type WriteSurface = "content" | "operations" | "grades" | "account";

/** What this credential may write *at all*, before any ownership rule. */
export function credentialAllows(actor: Actor, surface: WriteSurface): boolean;
```

| Kind     | content | operations | grades | account | Source                             |
| :------- | :------ | :--------- | :----- | :------ | :--------------------------------- |
| `USER`   | yes     | yes        | yes    | yes     | role and ownership decide the rest |
| `CLI`    | yes     | no         | no     | no      | FR-ACC-022                         |
| `BOT`    | no      | no         | yes    | no      | FR-ACC-022, FR-ACC-023, FR-GRD-030 |
| `SYSTEM` | yes     | yes        | yes    | yes     | FR-ACC-012                         |

- **content** — questions, exams, calendar events, resources (FR-ACC-010).
- **operations** — enrollment, invites, exam lifecycle and extra time, the
  course record.
- **grades** — scores, feedback, grading status (FR-GRD-030, FR-GRD-033).
- **account** — users, sessions, keys, disciplines, editions.

The composite predicates become a conjunction, and the order is the point:

```ts
export function canWriteCourseContent(actor: Actor, course: CourseWithEnrollment): boolean {
  return credentialAllows(actor, "content") && (isSystem(actor) || course.instructor.id === actor.id);
}
```

The ceiling never *grants* anything — it only removes. Ownership still decides
who, and the kind decides through what. That keeps one rule per question instead
of a matrix, and it means adding a kind later cannot accidentally widen an
existing rule.

FR-ACC-024's other half — that a `BOT` reads only responses and submissions in
its owner's courses, which is *narrower* than its owner reads — is a read
ceiling, and it has nothing to bite on yet: `ResponseService` and
`SubmissionService` do not exist. The table above is the write half. The read
half is declared in `06-grading.md` and enforced when those services land; this
spec does not pretend to cover it.

### `locals.actor` replaces the pun

```ts
declare namespace App {
  interface Locals {
    actor?: import("@/db/base-service").Actor;
  }
}
```

`locals.user` goes, and so does `locals.apiKey`. The current shape is a type pun
— `locals.user` is simultaneously "the logged-in person, for the navbar" and
"the actor, for every service call" — and it is why the key kind sitting in
`locals.apiKey` was never consulted: the value the services received had already
thrown it away.

The three middlewares each build a complete actor:

| Middleware                      | Builds      | `authenticationKey`     |
| :------------------------------ | :---------- | :---------------------- |
| `sessionMiddleware`             | `UserActor` | `session.user.username` |
| `apiKeyMiddleware`, `kind: CLI` | `CliActor`  | `apiKey.publicId`       |
| `apiKeyMiddleware`, `kind: BOT` | `BotActor`  | `apiKey.publicId`       |

`sessionService.validate` and `apiKeyService.validate` widen their selects to
include `username` and `publicId`. Neither currently returns them.

The 36 `Astro.locals.user` references become `Astro.locals.actor`. Pages that
want a person's *name* or *avatar* — the navbar, the profile page — load the
`User` row through `userService`, which is what they should have been doing:
`locals` is authorization state, not a display cache.

### This is one commit, and the compiler drives it

`SystemActor` losing `id`/`role` turns every unguarded `actor.id` into a type
error, and `locals.user` disappearing turns every page reference into another.
That is roughly 31 files, all mechanical, none of it a judgement call — which is
exactly the refactor that must not be split across commits, because a
half-migrated permission layer is one where some call sites read a shape that no
longer means what they think.

The existing service and permission tests are the safety net: they already cover
every predicate, and none of them should need a behaviour change — only the
construction of their actors.

## Schema

```prisma
model ApiKey {
  publicId String @unique   // nanoid, generated in the service like User.publicId
  …
}
```

Nothing else changes. Existing keys in a dev database get a generated `publicId`
in the same `db push`-plus-backfill shape the edition work used; production has
no keys yet.

## Tests

`test/permissions.spec.ts`:

- `credentialAllows` reproduces the table above in full — four kinds × four
  surfaces, sixteen assertions. It is FR-ACC-022 transcribed, so it should read
  like the requirement.
- **The regression this refactor exists for:** a `BotActor` whose `id` is the
  course's instructor is refused by `canWriteCourseContent`, and by every other
  content predicate the calendar and question specs add.
- A `CliActor` owning the course passes `canWriteCourseContent` and fails
  `canManageEnrollment` — content via CLI, operations via web.
- A forged actor, built with `JSON.parse('{"kind":"SYSTEM","authenticationKey":"system"}')`,
  is refused by every predicate. `isSystem` returns false for it.
- A compile-time assertion (`@ts-expect-error`) that `actor.id` is not readable
  before the system case is narrowed — the property that makes the migration
  self-checking.

`test/middleware.spec.ts`, new:

- A valid session cookie produces `kind: "USER"` with `authenticationKey` equal
  to the username.
- A `CLI` key produces `kind: "CLI"` with the key's `publicId`, and a `BOT` key
  `kind: "BOT"` — and in neither case does the actor carry the key itself.
- A request with both a cookie and a bearer header resolves to the session,
  which is today's precedence, now asserted rather than implied.
- No credentials produces no actor, and every guarded route redirects.

The existing agreement tests (`canViewUser`/`userVisibility`,
`canViewCourse`/`courseVisibility`, and the ones the calendar and question specs
add) keep passing with actors constructed the new way. If any of them changes
behaviour, the refactor has done something it should not have.

## Follow-up, not in this spec

- **The bot read ceiling.** FR-ACC-022's read column needs `ResponseService` and
  `SubmissionService` to exist before it can be enforced.
- **Per-course bot binding.** `01-accounts-access.md` asks whether a `BOT` key
  is scoped to one course or to all of its owner's; `kind` is the hook that
  question will hang on, and answering it now would be guessing.
- **An audit log.** `(kind, authenticationKey, operation, outcome)` is now a
  complete row. Nothing writes it yet.
- **`ForbiddenError` carrying the actor's kind**, so a refused CLI push says
  "a CLI key cannot drop a student" instead of "Forbidden".
- Showing `publicId` beside each key on `/profile`, so revoking the right one
  stops being guesswork.
