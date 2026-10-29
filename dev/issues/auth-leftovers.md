---
type: note
status: active
tags: [auth, invites, security]
relatedTo: [invite-service, api-auth]
---

# Auth: invites, logout and account errors

- `POST /api/auth/logout` deletes every session of the user and leaves the
  Bearer key valid. A CLI logout does not revoke its key.
- `inviteCreate` does not enforce the per-kind rules. An admin can create a
  CLASSROOM invite for INSTRUCTOR with unlimited uses; a PERSONAL invite with
  `email: null` can never be redeemed.
- `inviteUpdate` is not `.strict()`: `kind`/`role`/`email` are silently
  dropped instead of refused, and `maxUses` accepts 0, negatives and
  non-integers.
- `InviteService.redeem` maps any insert error to `already_redeemed`.
- The personal-invite email match is case-sensitive.
- API login skips hashing for an unknown user, so response time reveals
  whether an account exists.
- `POST /api/user` accepts any non-empty password: `userCreate` takes
  `min(1)` and `UserService.createTx` runs no `passwordStrengthIssues`. Only
  the admin form requires `min(8)`.
