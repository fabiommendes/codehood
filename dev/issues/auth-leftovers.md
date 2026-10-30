---
type: issue
status: completed
tags: [auth, invites, security]
relatedTo: [invite-service, api-auth]
closed: 2026-10-30
---

# Auth: invites, logout and account errors

- `POST /api/auth/logout` deletes every session of the user and leaves the
  Bearer key valid. A CLI logout does not revoke its key.
- `inviteCreate` does not enforce the per-kind rules. An admin can create a
  CLASSROOM invite for INSTRUCTOR with unlimited uses; a PERSONAL invite with
  `email: null` can never be redeemed.

Fixed: logout revokes the API key the request authenticated with, and
`inviteCreate` enforces the kind rules (CLASSROOM: student role, a course, no
email; PERSONAL: an email and `maxUses: 1`; `maxUses` an integer >= 1).
