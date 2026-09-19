# Permissions unification

Fold every `canActionTarget` predicate in `src/auth/permissions/index.ts` into
the `PERMISSIONS` table, so `hasPerm`/`ensurePerm` are the only way to ask an
authorization question.

## Goals

- One mechanism: a declarative table plus `hasPerm`/`ensurePerm`.
- Every permission gets an `audit` reducer, so failures never leak whole rows.
- `Perm` derives from the table, so an undefined permission is a type error.

## Public API changes

Removed exports (no replacements kept, no deprecation shims):

`canManageApiKeys`, `canManageSessions`, `canCreateCourseFor`, `canViewCourse`,
`canViewCourseContents`, `canUpdateCourseContents`, `canUpdateCourse`,
`canReadQuestion`.

`src/auth/permissions/permissions-utils.ts` (`curry2`, `curry3`) is deleted with
them: currying exists only to serve those predicates. Call sites that passed a
partially applied predicate (`pred: canViewCourseContents(actor)`) pass a closure
instead: `pred: (row) => hasPerm(actor, "course.read-contents", row)`.

### Replacement map

| Removed                             | Permission                                 | Target                |
| :---------------------------------- | :----------------------------------------- | :-------------------- |
| `canManageApiKeys(a, owner)`        | `api-key.manage`                           | `UserId`              |
| `canManageSessions(a, owner)`       | `session.manage`                           | `UserId`              |
| `canCreateCourseFor(a, instructor)` | `course.create`                            | `CourseTarget`        |
| `canViewCourse(a, c)`               | `course.read`                              | `CourseWithEnrollment`|
| `canViewCourseContents(a, c)`       | `course.read-contents`                     | `CourseWithEnrollment`|
| `canUpdateCourseContents(a, c)`     | `course.update-contents`                   | `CourseTarget`        |
| `canUpdateCourse(a, c)`             | `course.update`, `course.delete`           | `CourseWithEnrollment`|
| `canReadQuestion(a, q, false)`      | `question.read`                            | `QuestionWithCourse`  |
| `canReadQuestion(a, q, true)`       | `question.read-public`                     | `QuestionWithCourse`  |

`canReadQuestion`'s third argument becomes the choice of permission. A call site
holding a dynamic `isPublic` selects the key:
`hasPerm(actor, isPublic ? "question.read-public" : "question.read", row)`.

`CourseTarget`, `CourseWithEnrollment` and `QuestionWithCourse` stay exported;
they are now permission target types only.

### Rules to preserve exactly

- `api-key.manage` / `session.manage`: the owner, any admin, or `SYSTEM`.
- `course.create`: `SYSTEM` and admins may name any instructor; anybody else
  only themselves. The actor's role is otherwise not consulted.
- `course.read` and `course.read-contents` are the same rule today: `SYSTEM`,
  admin, the course's instructor, or an `ACTIVE` enrollment. They stay separate
  keys because `course.read` will later widen to any authenticated user.
- `course.update-contents`: `SYSTEM` or the course's own instructor. **No admin
  branch** — an admin who does not teach the course is denied. In the table this
  means an `other` check and no `admin` key.
- `course.update` / `course.delete`: `SYSTEM`, any admin, or the instructor.
- `question.read`: identical to `course.update-contents` on `question.course`.
- `question.read-public`: `question.read`, or `status === "PUBLISHED"` and
  `course.read-contents` on `question.course`.

### Type-level changes

- `Perm` becomes `keyof PermDefsByKey`: the table is the single source of truth,
  and every `Perm` is guaranteed to have a definition at runtime.
- The `RoleEntity` / `PermAction` / `ExtraPerms` vocabulary unions stay as the
  allowed namespace, still enforced by `_AssertPermissionsKeys`. Add the
  entities and extra permissions this change introduces (`question`, `api-key`,
  `session`, `question.read-public`, `api-key.manage`, `session.manage`) and
  drop `course.read-students`, which nothing defines or uses.
- `_AssertPermissionsAudited` already forces an `audit` on every permission that
  takes a target; the new entries must satisfy it.

## Audit shapes

- `api-key.manage`, `session.manage`: `{ owner }`.
- every `course.*` with a target: `{ id?, instructor }` (the existing
  enrollment audit shape, minus `user`).
- `question.read`, `question.read-public`: `{ id?, status, course }`, where
  `course` is the course audit shape.

## Call sites to update

`src/db/services/`: `api-key`, `session`, `course`, `question`, `resource`,
`time-slot`, `calendar-event`. Plus
`src/pages/[discipline]/[course]/resources.astro`.

Doc comments referencing the removed predicates by `{@link}` must refer to the
permission instead, or the typecheck fails on the dead link.

The Prisma `where` fragments (`courseWhere`, `courseContentsWhere`,
`questionWhere`, `userWhere`) keep their current shape and location. Only their
prose changes.

## Testing strategy

- Table-driven checks over the actor set (`SYSTEM`, admin, instructor, other
  instructor, enrolled student, outsider student) crossed with each new
  permission, asserting the rule table above. Each new permission needs the
  admin/non-owner row, which is where `course.update-contents` and
  `course.update` diverge.
- The agreement tests between a predicate and its Prisma fragment
  (`course-service`, `calendar-event-service`, `question-service`) keep their
  shape; the predicate side becomes a `hasPerm` call.
- `simplifyTarget` gets one case per new target shape, asserting the audit keeps
  only identifying fields and drops the rest of the row.
- One `ensurePerm` failure case per new entity, asserting `NotAllowed.target` is
  the simplified target.

## Acceptance criteria

1. No `can*` predicate remains in `src/auth/permissions/`; nothing outside the
   module imports one.
2. `permissions-utils.ts` is gone.
3. Behavior is unchanged: every rule above holds for every actor kind.
4. `pnpm run lint` (biome + typecheck + stories) exits 0 and the Playwright
   suite passes.
