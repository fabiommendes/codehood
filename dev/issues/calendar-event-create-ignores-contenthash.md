# `calendarEventService.create()` does not reject a missing `contentHash`

`test/calendar-event-service.spec.ts:199` ("create rejects a missing
contentHash; update stores the supplied one verbatim") fails, and has been
failing before the `upsert` work — confirmed by running the same spec against a
clean worktree at `HEAD`.

Cause: `calendarEventSchema.contentHash` is `z.string()` with no `.min(1)`, and
`create()` has no hand-written check either, so an empty string passes. The
sibling services disagree — `resourceCreate.contentHash` is
`z.string().min(1)`, which is what makes the equivalent resource test pass.

## Fix

Give `calendarEventSchema.contentHash` a `.min(1)`, matching
`resourceSchema.contentHash`. Check first whether any caller writes an empty
hash today; `create()` currently accepts one, so a row may already exist with
it in a long-lived database.

Unrelated to `dev/specs/to-review/service-upsert.md`, which left it alone
deliberately.
