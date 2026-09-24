---
type: spec
status: to-review
tags: [api, raw-ids, public-id, invite, api-key, openapi]
relatedTo: [dev/issues/api-leaks-raw-ids.md, dev/specs/to-review/course-ref-unification.md]
---

# The REST API never exposes raw database ids

Services take and return raw ids (`id`, `courseId`, `examId`, ...). They are
cheap and avoid joins. The REST API (`src/api/`) must not expose them:
clients address entities by natural key or by `publicId`. Background:
`dev/issues/api-leaks-raw-ids.md`.

## Rule

No request or response schema under `/api/` has a property called `id` or
ending in `Id`, and no path or query parameter does either. This applies at
any nesting depth, including arrays of objects. Exceptions:

- `publicId`.
- `githubId` and `schoolId`: external identities, not database ids.
- Anything inside an MDQ question document (the `question` property of the
  question entity). Its `id`s are author-chosen names that are part of the
  document.

A reference to another entity goes out as a bare string (`"response":
"<publicId>"`, `"exam": "<slug>"`). Inputs that reference an entity by
`publicId` take `{ publicId }`.

## Changes

### 1. `publicId` for Invite and ApiKey (schema change)

- Add `publicId String @unique` to `Invite` and `ApiKey` in
  `prisma/schema.prisma`. Generate it the way response does (`generateToken(9)`).
- `/api/invite/[publicId]` and `/api/api-key/[publicId]` replace `[id]`.
- The invite `token` and the api-key `token` are still returned only by create.
- The project applies the schema with `prisma db push` (the migrations folder
  is stale). Run `pnpm run db:generate` after editing the schema, and
  `pnpm run db:reset` for the dev database.

### 2. Username fields are named after what they hold

`authorId` becomes `author`, `graderId` becomes `grader`, `botId` becomes `bot`,
and `createdById` becomes `createdBy` wherever the value is a username or a bot
name rather than a numeric id. This covers entity, create and filter schemas
for exam, response, feedback, invite and api-key. Prisma field names stay the
same; services map them.

### 3. Foreign keys go out as the referenced entity's public key

The service output keeps its raw ids and adds the public reference next to
them. API entity schemas in `src/api/index.ts` omit the raw ids.

| Entity     | Omit over the API                 | Add (service output and API)                               |
| :--------- | :-------------------------------- | :--------------------------------------------------------- |
| exam       | `id`, `questions[].id`            |                                                            |
| question   | `id`                              |                                                            |
| time-slot  | `id`, `courseId`                  |                                                            |
| response   | `id`, `courseId`, `examId`        | `exam` (slug), which replaces `examSlug`                   |
| submission | `id`, `responseId`, `questionId`  | `response` (publicId), `question` (slug)                   |
| feedback   | `id`, `submissionId`              | `submission` (publicId)                                    |
| invite     | `id`, `courseId`                  | `publicId`, `course` (natural key or `null`)               |
| api-key    | `id`                              | `publicId`                                                 |

### 4. API inputs take no raw ids

- The submission list filter's `response` and the submission create body's
  `response` accept `{ publicId }` only over the API. The service still
  accepts `{ id }`.
- `/api/api-key` filters by `createdBy` (a username).

### 5. Guard test

A test walks `buildOpenApiDocument()`: every path, every operation, its
parameters, request body and responses, resolving `$ref`s into
`components.schemas`. It fails if any property or parameter is called `id`
or ends in `Id` (other than `publicId`), and the failure message lists every
offending path.

## Acceptance

- The guard test passes.
- Invite and api-key: create returns a `publicId` and the token. GET and DELETE
  by `publicId` work. The old numeric-id routes are gone (404).
- Response, submission and feedback, read over the API, carry the public
  references in the table and none of the raw ids.
- Pages and actions keep working. They use services, so they still see raw ids.
- `pnpm run lint` exits 0 and `pnpm test` passes.
