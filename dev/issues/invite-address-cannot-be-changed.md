# A student whose invite went to a dead address has no way through

`src/pages/invite/[token].astro` renders a personal invite's address into a
`readonly` input, so the redeemer cannot submit a different one. The
`email_mismatch` code that `InviteService.checkRedeemable` returns, and the
"This invite was issued for a different email address." message that
`src/actions/auth.ts` maps it to, can only be produced by POSTing the action
directly, which no user does.

The catalogue used to contradict itself about this: "Fail to redeem a stale
invite" promised the page explains an email mismatch, while "Redeem a personal
invite" stated the address is pinned. The catalogue has since been rewritten to
match the code, and `test/stories/student-joining-the-platform.test.ts` asserts
the address is pinned. The guard in the action stays as defence in depth, since
it is a public endpoint.

What remains is the design question underneath, which nobody has answered:

**Should the address be editable?** A student may hold an invite sent to an
address they no longer read. Today they cannot redeem it at all and the page
never tells them why, so they have to go back to whoever invited them without
knowing what to ask for. Either the field opens up and the mismatch message
becomes reachable, or the page should say plainly that the invite is tied to
that address and a new one has to be issued.

The second is cheap and worth doing regardless.
