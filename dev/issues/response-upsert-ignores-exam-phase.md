---
type: note
status: active
tags: [response-service, exam-phase, upsert]
relatedTo: [exam-state, response-service]
---

# `response.upsert` opens attempts on exams that are not open

`response.create` refuses unless `examPhase(exam, now)` is `open`, but
`response.upsert` does not check the phase. A client can therefore open an
attempt on an upcoming or closed exam. `submit` still refuses to write into
it, so no answer lands, but the empty attempt makes the student's exam page
show "Submitted" instead of "Upcoming" or "You did not take this exam".

Decide whether `upsert` follows the same rule as `create` for students while
staying free for the instructor and the CLI (who may need to backfill).
