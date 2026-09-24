---
type: note
status: active
tags: [actions, raw-ids, web-client]
relatedTo: [dev/specs/to-review/api-no-raw-ids.md]
---

# Astro Actions take raw course and api-key ids from the browser

The REST API no longer exposes raw ids (see
`dev/specs/to-review/api-no-raw-ids.md`). The Astro Actions used by the web
app still do: `src/actions/course.ts`, `question.ts` and `auth.ts` take
`courseId: number`, and `revokeApiKey` takes the api key's numeric `id`.
`StudentsTable` and `QuestionsTable` receive `courseId` as a prop for those calls.

## Fix

- Course-scoped actions take the course natural key (or the page passes the
  URL's `discipline` and `course` segments).
- `revokeApiKey` takes the `publicId`.
