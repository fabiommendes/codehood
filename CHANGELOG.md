# Changelog

## Unreleased

### Added

- `GET /api/health`: an unauthenticated liveness/readiness probe for uptime
  monitors and orchestration systems. Confirms the server can reach the
  database, not just that the process is up. See
  `docs/design/url-structure.md`.
- OpenAPI 3.0 documentation for the REST API at `/openapi.json` (`pnpm
  openapi` to regenerate; runs automatically before `pnpm build`), generated
  with `@asteasolutions/zod-to-openapi` from the same Zod schemas
  `/api/auth/cli-login` and `/api/health` validate requests against, so the
  spec and the validation can't drift apart. Browsable as Swagger UI at
  `/api/docs`, self-hosting its `swagger-ui-dist` assets rather than pulling
  them from a CDN. See `docs/design/openapi.md`.
- Authentication and registration of new users: invite-only accounts (personal
  single-use invites and reusable classroom join codes), Argon2id password
  hashing, session-cookie login for the web app, and API-key login for the
  CLI/grading bots. Admin accounts are bootstrapped via `manage create-user`
  (or automatically in dev). See `docs/implemented/auth.md`.
- User profile page (`/profile`): edit your own name, email, GitHub id, and
  school id (username is shown but not editable); change your password; log
  out of every session; manage your own CLI/bot API keys (create, list,
  revoke). See `docs/implemented/profile.md`.
- Courses: `/courses` lists what you take and what you teach; a course's
  page (`/<discipline>/<username>_<edition>`) shows its real title,
  instructor, description, and enrolled headcount; instructors get a real
  `/manage` and `/roster` (with student names, usernames, and emails); the
  classroom-invite flow enrolls the invited student in the real course
  instead of a hardcoded id. `CourseService` and `DisciplineService` join
  the access-controlled services, with a new `Enrollment` table backing
  visibility (who teaches a course, or holds an `ACTIVE` enrollment in it).
  `manage create-course` creates a course (and its discipline, if new) —
  the only way in until the CLI sync lands in 0.2.0. The schedule, exams,
  gradebook, and resources sections stay mocked, deliberately, and labelled
  as preview data on screen. See `dev/specs/to-review/courses.md`.
- Design system: a custom daisyUI theme (colors and radii matching the
  existing brand mark), a Space Grotesk/IBM Plex Sans/IBM Plex Mono type
  system, four page layouts (`Layout`, `AppLayout`, `CenteredLayout`,
  `DesignLayout`), reusable UI components (`Button`, `Badge`, `Alert`,
  `Card`), and a `/design/*` showcase (Typography, Colors, Layouts,
  Elements; Forms is a stub, deliberately not built out yet). The existing
  pages (home, login, invite-acceptance, profile) were refactored onto the
  new layouts and components rather than left as unused scaffolding.

### Changed

- Access control moved into the service layer instead of living in the
  Astro Actions/page callers. `UserService`, `SessionService`,
  `ApiKeyService`, and `InviteService` now require an `actor` (a real user,
  or the `SYSTEM` sentinel for trusted internal callers) on every method and
  enforce visibility themselves — listing users, issuing/revoking API keys
  and sessions, and creating invites all check the actor internally rather
  than trusting the caller to have checked first. See
  `docs/design/service-access-control.md`.

### Fixed

- `/profile` let a user change their own username, which is the foreign key
  `Course.instructor` targets (`Course.instructorId` references
  `User.username`). Renaming silently moved every course URL that
  instructor owns, breaking existing links with no redirect. Username is
  now read-only on `/profile`, and `userService.update` rejects any
  `username` key in its update fields at runtime.
