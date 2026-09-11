# `inviteService.create` never returns the raw invite token

**Severity:** High — both invite-issuing actions hand the caller `undefined` instead of a
token, so there is no way to obtain an invite link from the UI or the API.

**Location:** `src/db/services/invite.service.ts` (`create`), `src/db/services/invite.service.ts` (`fromDb`)

## What's wrong

`create` generates a token, persists only its hash, and then returns `fromDb(invite)`:

```ts
const token = generateToken();
const invite = await client.invite.create({
	data: { tokenHash: hashToken(token), ... },
});
return fromDb(invite);
```

`fromDb` builds the public entity from the database row, which has no `token` column — so
the returned object never carries `token`, even though `inviteSchema` declares it
(`token: z.string().optional()`, commented "Only show once, when the invite is created").
The raw token is discarded when `create` returns, and since only its hash is stored it is
unrecoverable afterwards.

Both callers therefore destructure `undefined`:

```ts
// src/actions/auth.ts — createPersonalInvite and createClassroomInvite
const { token } = await inviteService.create({ ... }, { actor });
return { token };
```

Reproduced over HTTP against the dev server, logged in as `admin`:

```
$ curl -X POST /_actions/auth.createPersonalInvite \
    -d '{"email":"newcomer@codehood.local","role":"STUDENT","courseId":1}'
[{"token":-1}]      # devalue encoding for undefined
```

The invite row itself is created correctly and renders on `/admin`; only the token is lost.

## Why it matters

An invite is useless without its token — that is the credential the `/invite/[token]` page
consumes. `createPersonalInvite` and `createClassroomInvite` both appear to succeed while
returning nothing usable.

## Suggested fix

Mirror what `apiKeyService.create` already does for the identical "shown once, never stored"
case:

```ts
const result = fromDb(invite);
result.token = token; // only here, never in the database
return result;
```

## Notes

Pre-existing — confirmed present at commit `f1125e7`, so it is not fallout from the
username-as-id refactor. Found while renaming `Invite.createdByUsername` to `createdById`.
A regression test asserting `create(...).token` is a non-empty string, and that `findOne`
never returns one, would keep it fixed.
