# Backlog

Those are issues and vague future plans for the Codehood project. Items in the
backlog are not necessarily prioritized or scheduled for implementation. Pick
the items in the BACKLOG and move them to the ROADMAP once a milestone is set
and a rough schedule is agreed upon for a set of backlog items.

Backlog items are categorized in sections, not on priority.

## Small issues

* [ ] **Schema hygiene in `src/core/schemas/`** — create/update schemas
  retyped instead of derived from `xSchema`, and `.optional()` used where the
  column is nullable (so the field can never be cleared). See
  `dev/issues/schemas-verbose-and-optional-vs-nullable.md`.
* [ ] **Relative expiry breaks idempotency** — `inviteCreate.expiresInMs` and
  `passphrase.create`'s implicit deadline make the same request produce a
  different row every time, which is why both services have no `upsert`. See
  `dev/issues/relative-expiry-breaks-idempotency.md`.
* [x] Decide whether `tsc --noEmit` joins `pnpm run lint`. `lint` is `biome ci .`,
  which does not typecheck, so the enrolled-student 403 fixed in this release sat
  in `main` through a whole refactor while `tsc` reported it at nine call sites
  and CI stayed green.
* [x] Remove the generated openapi.json. Instead, we should generate once during 
  startup, cache it and serve this file

## UI issues

* [ ] In the /design/questions page, the floating navbar should float to the left
  of the main container. It should not share the same horizontal space as the content.
* [ ] There are some title patterns that re-appear somewhat inconsistently
  across different pages. Standardize the title patterns to a single component.
  It has a subtitle above the main title. The main title and an optional subtitle below it.
  The upper subtitle have two modes:
  - Mode 1: blue subtitle with the BrandSquares.
  - Mode 2: it is a badge.
* [ ] Profile page should add the option to upload a profile picture.


## Architecture

* [ ] Make a mechanism to declare astro actions similar to the CRUD function 
  that register routes for RESTful APIs.
* [ ] Extend the natural-key REST addressing to `passphrase`, which has no
  REST endpoint yet (`calendar-event`, `resource`, `exam` and `time-slot` are
  done). `passphraseCreate` and
  `passphraseFilter` already take `course: CourseRef`, so registering the
  `CRUD` route is the only piece left. Once every endpoint is addressable
  naturally, drop `id` from the REST responses (but never from
  `courseSchema`, which the frontend and services keep using).

## Features

* [ ] The Essay question should use a rich text editor component for better
  content formatting. Investigate suitable rich text editor libraries and
  integrate it in the component. It should provide a user-friendly interface
  and a raw markdown mode for advanced users.

## Maintainability

* **Permanent:** go through all `any` types and replace them with more specific
  types where possible. We can use advanced TypeScript features and the module
  `utils/types.ts` have great helpers. If `any` can't be avoided, create a type
  alias with a descriptive name for that use and add a comment explaining why
  that `any` is necessary.
* **Permanent:** go through the FIXME/TODO items. If it is an easy fix, fix it.
  Otherwise, remove the comment and save it in the corresponding section in the
  backlog.
* **Permanent:** review all code comments and ensure they are up-to-date and
  relevant. Refactors can make comment drift, so we need to keep them in sync
  with the code. If a comment is no longer relevant, remove it. If a comment is
  unclear or incomplete, update it to provide accurate information. If the
  comment is too long or complex, consider making a summary or breaking it into
  smaller comments. Documentation facing comments (TSDoc) should be kept
  especially accurate and up-to-date. TSDocs never refer to planning
  discussions, temporary notes or documents under /dev/. If the reference is
  relevant to understanding the implementation, break the comment in two: the
  main TSDoc comment for the public API, and a separate `//` comment for the
  implementation details and decisions.
* **Permanent:** fix any typos and grammatical errors throughout the codebase,
  including comments, documentation, and variable and function names. Make
  sure not breaking any call site when editing the later two.


## Infrastructure

* Implement email providers with plugins. 


## Auth

* E-mail password reset flow.
* OAuth2 login.
* 2FA (TOTP) for instructors and admins.


## Questions and exams

* **Question weights per exam.** Weights come from the question version
  today; a per-exam override is in
  `dev/issues/peso-da-questao-por-prova.md`.
