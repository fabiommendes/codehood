---
type: spec
status: to-do
tags: [actions, raw-ids, islands, public-id, password-hash]
relatedTo: [dev/specs/to-review/api-no-raw-ids.md, dev/issues/api-leaks-raw-ids.md]
---

# Nothing sent to the browser carries raw ids or secrets

The REST API no longer exposes raw database ids
([api-no-raw-ids](../to-review/api-no-raw-ids.md)). The web app still does,
through three channels:

1. Astro Action inputs (form fields and client calls) take `courseId`, an
   api key `id` or an invite `id`.
2. Astro Action results are serialized to the client, and some return service
   entities as they are. `admin.createUser` and `auth.acceptInvite` return the
   full `User`, **including `passwordHash`**.
3. Props of hydrated islands (`client:*`) are serialized into the HTML, e.g.
   `StudentsTable` rows carry `courseId` and the component takes a `courseId`
   prop.

## Rule

The same rule as the REST API: nothing that reaches the browser (action input,
action result, island props) has a property called `id` or ending in `Id`,
except `publicId`, `githubId` and `schoolId`. A key named exactly `id` counts
only when its value is a number: every raw database id is an integer, while
MDQ documents use author-chosen string ids. Action results and island props never contain `passwordHash`,
`keyHash` or `tokenHash`.

Server-side page code (frontmatter) may keep using raw ids; they just must not
end up in the HTML.

## Changes

- **Course-scoped actions** (`course.addStudent`, `course.dropEnrollment`,
  `course.generatePassphrase`, `question.updateStatus`,
  `auth.createClassroomInvite`, `auth.createPersonalInvite`) take the course
  as `discipline` plus `course`, with the same grammar as the URL segments
  (`<instructor>_<edition>`). `parseCourseParams` in `src/api/utils.ts` already
  parses that. Move it to `src/urls/` so actions and the API share it; don't
  import across `src/api` and `src/actions`.
- **`auth.revokeApiKey` and `admin.revokeInvite`** take `publicId`.
- **Action results** are explicit whitelists, never a service entity passed
  through. `auth.ts` already has `publicUser()`; reuse it for `createUser` and
  `acceptInvite`. `generatePassphrase` and `updateStatus` return only what
  their callers render.
- **Island props:** `StudentsTable`, `QuestionsTable` and any other `client:*`
  component receive the course as `{ discipline, course }` segments and rows
  without raw ids. Keep the service data server-side and map it before
  passing it.

## Acceptance

- Every action above works through its page (the existing story tests) with
  the new inputs.
- A test renders the pages that hydrate islands (at least roster, questions,
  exams, admin, profile and getting-started, as the users who see them) and
  scans every `astro-island` `props` attribute. It fails on any id-shaped key
  (same exemptions as the REST guard) and on any `*Hash` key.
- A test calls `admin.createUser` and `auth.acceptInvite` and asserts that the
  result has no `passwordHash` and no id-shaped keys.
- `pnpm run lint` exits 0 and `pnpm test` passes.
