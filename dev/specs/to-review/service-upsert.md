# Service `upsert`

Every `src/db/services/*.service.ts` gains a real `upsert` where the entity has
a stable natural key. `upsert` is the CLI sync primitive: the PUT to `update`'s
PATCH.

## Scope

Implemented for seven services:

| service | natural key |
| :------------- | :------------------------------------- |
| user | `username` |
| discipline | `slug` |
| edition | `slug` (already implemented, rewritten) |
| course | `ref` = discipline + instructor + edition |
| time-slot | `ref` = courseId + slug |
| resource | `ref` = courseId + slug |
| calendar-event | `ref` = courseId + slug |

Excluded, keeping their `upsert: never` stub plus a one-line reason:

- `api-key`, `invite`, `session` — `create` mints a secret and returns a
  token-plus-entity wrapper, not the entity. Re-minting on every sync is wrong.
- `file` — content-addressed: `slugHash` is derived from `bytes`, so "the row
  already exists" means the bytes are identical and there is nothing to update
  but `mimeType`.
- `passphrase` — `value` is server-generated unless pinned, and the only
  updatable field is `expiresAt`.

`invite` and `passphrase` become upsertable once their creates take an absolute
`expiresAt` (see `dev/issues/relative-expiry-breaks-idempotency.md`).

## Placement

`upsert` goes directly below `update` in every service file, stub or not.

## Input

`xUpsert`, its own exported schema, defined as `xCreate` wherever the two
coincide:

```ts
export const disciplineUpsert = disciplineCreate;
```

It is a named schema rather than a direct reuse of `xCreate` because create-only
fields are a live category here (`password`, `expiresInMs`, `contentHash`):
adding one to an `xCreate` must be a decision about upsert, not a silent
widening of its contract.

`userUpsert` is the one divergence: `userCreate.partial({ password: true })`.
A `password` present on the update branch resets the stored one (useful in
tests); absent, the stored hash is left alone.

`id` is never accepted. The natural key is the identity and is immutable: an
upsert whose key does not match an existing row creates a new one. Renaming
stays an explicit `update`.

## Tri-state fields

A field in `xCreate`/`xUpdate` backed by a nullable column is `.nullish()`:

- absent — keep the stored value (update branch) / use the default (create branch)
- `null` — clear it
- a value — set it

`.optional()` alone means "I am not saying", which cannot express a deletion and
makes a locally-deleted description unsyncable.

Consequence: `upsert` is not a blind full replacement. Fields the caller omits
keep their stored value, so a CLI syncing a local file as the source of truth
must send explicit `null`s for what it deleted. Stated in each `upsert`'s TSDoc.

## Mechanism

Judgment call per service, on one rule: native `prisma.upsert()` only when the
service's `create`/`update` do no DB work the upsert would have to repeat.

- **Native `prisma.upsert()`** — discipline, edition. One permission predicate
  across every branch (`canManageDisciplines`, `canManageEditions`) and pure
  validation, extracted into a shared `assertX` the other methods call too.
- **`upsert()` helper in `base-service.ts`** — user, course, time-slot,
  resource, calendar-event. Their creates and updates resolve an instructor
  username, run an overlap query, check weekday collisions, or validate
  resource-shape-by-type; a native upsert would re-run all of it, so the
  saved round trip is imaginary.

### Helper changes

The helper takes a `client: PrismaClient` and always runs inside a transaction,
reusing an outer one when there is one:

```ts
opts.tx ? run(opts.tx) : client.$transaction((tx) => run({ ...opts, tx }))
```

This closes the findOne/create race.

The existence probe calls `service.findOne` with the real actor. `findOne` on
`user` and `course` is permission-gated and throws `NotAllowed`; the helper
re-tags it to `upsert-x` via a new `NotAllowed#as(action)`, which returns a new
instance carrying the same status, target and message.

## Permissions

An upsert is a PUT: the same request must have the same permission outcome
whatever the server's current state. So:

> Create permission is required always. Update permission is required in
> addition when the row already exists.

Branch-scoped checking (create permission only when absent, update permission
only when present) is rejected: it makes the same request succeed or fail
depending on whether the row happens to exist.

Implementation runs each check exactly once. The create branch's `create()`
already enforces the create permission, so the helper takes an
`assertCreatable` hook that fires **only on the update branch**:

```ts
if (existing) {
  await args.assertCreatable?.(entity, opts);
  return service.update(pk, args.update(entity), opts);
}
return service.create(args.create(entity), opts);
```

`assertCanCreateX(client, input, opts)` is extracted for course and user, where
the check needs a DB lookup; the other five pass a one-line predicate.

No `canUpsertX` predicates. Checked against `src/auth/permissions.ts`, every
in-scope service's upsert rule is exactly `create && update` today:
discipline/edition use a single predicate for all branches; time-slot, resource
and calendar-event both gate on course write access; course's two predicates
coincide for an instructor's own course. `user` is the only real conjunction —
`canCreateUser` (admin) plus `canEditUser` (owner or admin) — which makes PUT of
a user admin-only, while a student editing their own profile keeps using
`update`. Add a `canUpsertX` when one genuinely diverges, not before.

### Course's edition window

`course.create` also rejects a course in a closed edition unless the actor has
`canCreateCourseOutsideWindow`. That rule runs on the **create branch only**. It
is state-dependent, which the permission rule above is not, but the alternative
makes last term's material permanently un-syncable.

## Schema fixes carried by this task

- `calendarEventSchema.examId`: `.optional()` → `.nullable()`. Its sibling
  `exam` is already `.nullable()` and the column is `examId Int?`.
- `userSchema.githubId` / `schoolId`: `.optional()` → `.nullable()`, with
  `unmask()` returning `null` and the consumer sweep that follows. Dropping the
  `nullSentinel` hack for a real nullable column needs a migration and is
  deferred.
- `courseUpdate` and `disciplineUpdate` gain the missing `.partial()`.
  `courseUpdate` currently demands `description`, `startAt` and `endAt` on every
  PATCH.
- `src/core/schemas.ts:628`: a `z.object({courseId})` assigned to nothing.
  Deleted.

`apiKeySchema.token` and `inviteSchema.token` stay `.optional()`: that is
output-shape optionality (present only in the create response), not a nullable
column in disguise.

## Out of scope

Tracked in `dev/issues/`:

- `xCreate`/`xUpdate` schemas should derive from `xSchema` via
  `pick`/`omit`/`extend`/`partial` instead of being retyped by hand.
- `inviteCreate.expiresInMs` / `passphraseCreate`'s implicit expiry should
  become an absolute `expiresAt` with an `expiresIn(ms)` helper for callers.
