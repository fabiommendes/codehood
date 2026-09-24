---
type: note
status: active
tags: [api, raw-ids, openapi, entity-schemas]
relatedTo: [dev/specs/to-do/course-ref-unification.md]
---

# REST API leaks raw database ids

Services may take and return raw ids (`id`, `courseId`, `examId`, ...): they
are cheap and avoid joins. The REST API must not expose them. Clients address
entities by natural key or `publicId`.

## Where they leak today

Entity (output) schemas passed to `CRUD()` in `src/api/index.ts` without
omitting ids:

- exam: `id`
- question: `id`
- time-slot: `id`, `courseId`
- response: `id`, `courseId`, `examId`
- submission: `id`, `responseId`, `questionId`
- feedback: `id`, `submissionId`
- invite: `id`, `courseId` (`/api/invite` is addressed by `[id]`, so it needs a
  public key first)

Inputs:

- `submissionFilterBase.response` accepts `{ id }`, and so do the submission
  and feedback keys (`submissionPK`, `feedbackPK`). The API should accept
  `{ publicId }` only.

Related naming issue: `authorId` and `graderId` hold usernames, not ids. The
API calls them `author` and `grader`.

Invite has no public key: `tokenHash` is one-way and the token is shown only
once, so the creator cannot use it to address the invite later. Add a
`publicId` column (same generator as response and submission) and address
`/api/invite/[publicId]`. `tokenHash` was rejected as the key: it ties the
invite's identity to its credential, so rotating the token or changing the
hash scheme would change the key.

## Fix

- Omit raw ids from API entity schemas. References to other entities become
  their natural key or `publicId`, which the service already has or can join.
- Narrow API input schemas to non-id forms.
- Add a test that walks the OpenAPI document and fails on any property named
  `id` or ending in `Id` under `/api/`.
