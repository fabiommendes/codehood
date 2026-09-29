---
type: note
status: active
tags: [services, upsert, concurrency]
relatedTo: [base-service, feedback-service]
---

# Upserts race on a new key

`upsert` in `base-service.ts` runs `findOne` then `create` without a
transaction. `course.upsert` and `resource.upsert` call it without one, and
`FeedbackService.upsertTx` has the same shape. Two concurrent PUTs on a new
key make the second fail on the unique index (`InvalidData`) instead of
updating.
