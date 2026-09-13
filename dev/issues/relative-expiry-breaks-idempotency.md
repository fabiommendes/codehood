# Relative expiry on create breaks idempotency

`inviteCreate` takes `expiresInMs` and `passphraseService.create` computes its
own deadline. Both mean the same request produces a different row every time it
is sent: the resulting `expiresAt` depends on when the server received the call,
not on what the caller asked for.

That is why `invite` and `passphrase` are excluded from
`dev/specs/to-do/service-upsert.md`: an upsert whose result depends on wall
clock is not an upsert. It is also the reason `inviteUpdate` already takes an
absolute `expiresAt` while `inviteCreate` does not — the two halves of the same
entity disagree about how expiry is expressed.

## Fix

- `inviteCreate.expiresInMs` → `expiresAt: z.date()`.
- `passphraseCreate` gains an explicit `expiresAt`.
- Export `expiresIn(ms: number): Date` from `src/utils/` for callers that think
  in durations, so the convenience survives without living in the schema.

Once done, both services can take a real `upsert` (natural keys: the invite's
token hash is unusable, so `invite` likely stays excluded; `passphrase` keys on
`value`).

## Cost

API contract change. Touches `public/openapi.json`, the REST controllers, the
Astro actions and any CLI caller. Not a drop-in.
