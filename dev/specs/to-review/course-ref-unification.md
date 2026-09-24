---
type: spec
status: to-review
tags: [api, services, schemas, course]
relatedTo: [dev/specs/to-review/course-scoped-resource-api.md, dev/specs/to-review/course-natural-key-api.md]
---

# One way to reference a course: `{ course: CourseRef }`

Course-scoped services reference their course in three incompatible ways:

- `course: CourseId | CourseNaturalKey` (exam, resource, calendar-event create)
- `courseId: CourseId | CourseNaturalKey` (question, response, time-slot, enrollment create)
- `courseId: number` or the natural key spread flat as `discipline`,
  `instructor`, `edition` (every filter and composite key)

The API layer papers over this with per-route `parseCreateParams` and
`parseListParams` that differ only in the field name.

## Rule

Every service **input** that references a course uses one field:

```ts
course: CourseRef // = CourseId | CourseNaturalKey
```

This covers create, upsert, filter and composite key schemas. The flat spread
form (`{ discipline, instructor, edition, slug }`) goes away:
`{ course: { discipline, instructor, edition }, slug }` replaces it.

Out of scope:

- Output (entity) schemas keep `courseId`. Whether it leaves the API is a
  separate item.
- The Prisma schema and the database.
- `calendarEventFilter.courseIds` (a multi-course listing for `/calendar`).

## Changes

1. `src/core/schemas/course.ts`: export `courseRef = z.union([courseId,
   courseNaturalKey])` and its `CourseRef` type, unless an equivalent exists.
2. Schemas of calendar-event, enrollment, exam, feedback, invite, passphrase,
   question, resource, response, submission, time-slot: rewrite every
   course-referencing input field to `course: courseRef`. A filter that was a
   union of "by id" and "by natural key" collapses to one object.
3. Services: resolve `course` with `courseRefWhere` (`src/db/utils.ts`).
   Behavior is unchanged apart from the input shape.
4. `CRUD()`: course-scoped routes declare the scope once. A single
   `parseScopeParams: (p) => ({ course: parseCourseParams(p) })` feeds list,
   create, upsert and composite keys, and the per-route `parseCreateParams`
   and `parseListParams` go away where they only did that.
5. Update every caller: pages, actions, commands, fixtures, seeds, tests.

## Acceptance

- `grep -rn "courseId" src/core/schemas` only matches entity (output) schemas.
- No input schema spreads `courseNaturalKey.shape`.
- Every course-scoped service accepts both a numeric id and a natural key under
  `course`, proven by one table-driven test over the services.
- The OpenAPI query parameters of course-scoped list routes contain no course
  fields (existing tests in `test/openapi.spec.ts`, extended to all routes).
- `pnpm run lint` exits 0 and `pnpm test` passes.
