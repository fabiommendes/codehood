---
type: issue
status: todo
tags: [auth, invites, security]
relatedTo: [invite-service, api-auth]
---

# Auth: invites, logout and account errors

- `POST /api/auth/logout` deletes every session of the user and leaves the
  Bearer key valid. A CLI logout does not revoke its key.
- `inviteCreate` does not enforce the per-kind rules. An admin can create a
  CLASSROOM invite for INSTRUCTOR with unlimited uses; a PERSONAL invite with
  `email: null` can never be redeemed.
