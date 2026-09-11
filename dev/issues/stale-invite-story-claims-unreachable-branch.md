# "Fail to redeem a stale invite" describes a branch the UI cannot reach

The story at `docs/user-stories/student.md` ("Fail to redeem a stale invite")
promises the page distinguishes three cases: the invite expired, it was issued
for a different email address, or it has already been used.

Only two of those are reachable through the browser.

`src/pages/invite/[token].astro` renders a personal invite's address into a
`readonly` input, so a redeemer cannot submit a different one. The
`email_mismatch` code that `InviteService.checkRedeemable` returns — and the
"This invite was issued for a different email address." message that
`src/actions/auth.ts` maps it to — can therefore only be produced by POSTing
the action directly, which no user does.

Found while writing the story test, which now covers the expired and
already-used branches and asserts the address is pinned instead of the third
(`test/stories/student-joining-the-platform.test.ts`).

The catalogue contradicts itself on this. "Redeem a personal invite", a few
entries earlier in the same file, states plainly that "the e-mail field is
pre-filled and cannot be changed, since the invite was issued for that
address" — which is exactly what makes the third branch unreachable.

Either is defensible; it needs a decision:

- **The guard is defence in depth.** The action is a public endpoint and should
  keep re-checking regardless of what the form allows. Then the story is wrong
  and should drop its third case.
- **The address should be editable**, because a student may hold an invite sent
  to an address they no longer use, and the current design gives them a dead
  end with no explanation. Then the page is wrong and the story stands.

The second is the larger question: today a student in that position cannot
redeem at all, and the page never tells them why.
