# Any actor can read any invite by its numeric id

`InviteService.findOneTx` skips the permission check for both lookup keys. The
comment justifies it for `{ token }`: the raw token is the credential, and the
acceptance flow needs to look it up before the redeemer has an account. That
reasoning does not cover `{ id }`. Ids are sequential, so a student can walk
them and read every invite's email, invited role, course and creator.

`findMany` is filtered through `inviteVisibility`, and `update`/`delete` check
`invite.update`/`invite.delete`, so `findOne({ id })` is the only unguarded
read path.

Fix: when looking up by `id`, return the invite only if the actor has
`invite.read` on it. Keep the token lookup unfiltered. Add a test where a
student and a non-issuing instructor get `null` (or `NotAllowed`) for another
instructor's invite id.
