# Codehood

Codehood is a simple Learning Management System (LMS) optimized for geeky types. In Codehood, most course material is stored and crafted locally
and syncronized with the server using a CLI tool. This repository holds the
server and, under `cli/`, the CLI (see [CLI](#cli)). They talk only through the
REST API.

The server is built with Astro, SolidJS and DaisyUI for the frontend. The database
is managed with Prisma ORM and SQLite. All database tables have Service classes
that abstract the database access. Astro Actions and the Rest endpoints
are only thin layers around those services.

## Project layout

Here are some files and folders agents might be interested in:

| File                       | Description                                                                           |
| :------------------------- | :------------------------------------------------------------------------------------ |
| `README.md`                | Generic description and guidelines.                                                   |
| `ROADMAP.md`               | Roadmap and future plans. Very brief descriptions of upcoming features.               |
| `BACKLOG.md`               | Tasks to be implemented or are currently being implemented and request review.        |
| `CHANGELOG.md`             | Validated entries in the backlog are condensed and recorded here, Skip trivial fixes. |
| `GLOSSARY.md`              | Glossary of terms used in the project.                                                |
| `AGENTS.md`                | This file.                                                                            |
| `prisma/schema.prisma`     | Database schema.                                                                      |
| `<dir>/README.md`          | Longer-lived conventions for each directory[^readme].                                 |
| `dev/specs/to-do/*.md`     | Detailed guidelines for implementation of specific features.                          |
| `dev/specs/to-review/*.md` | Specs that are ready for review before implementation.                                |
| `dev/issues/*.md`          | Store issues and bugs. Once fixed, register in the changelog and delete the file.     |
| `dev/adr/*.md`             | Short architecture decisions; how to use a cross-cutting API (e.g. forms).            |
| `dev/rfc/*.md`             | Designs under discussion, and accepted best practices (e.g. how to write a Service).  |
| `src/api/`                 | Implements controllers for the REST API.                                              |
| `src/actions/`             | Implements Astro Actions.                                                             |
| `src/auth/`                | Authentication and authorization. Permission rules.                                   |
| `src/commands/`            | Management CLI commands.                                                              |
| `src/components/`          | Reusable UI components.                                                               |
| `src/core/`                | Core schemas (Zod validators), error types, and constants.                            |
| `src/db/`                  | Database schema (Prisma) and service classes for data access.                         |
| `src/fixtures/`            | Test data factories.                                                                  |
| `src/forms/`               | Form logic derived from zod schemas: field specs, FormData coercion, error map.       |
| `src/generated/`           | Generated code from scripts (do not edit).                                            |
| `src/layouts/`             | Astro layouts.                                                                        |
| `src/mdq/`                 | Question data models and scoring logic.                                               |
| `src/middleware/`          | Middleware for Astro and the REST API.                                                |
| `src/pages/`               | Astro pages.                                                                          |
| `src/rpc/`                 | RPC endpoint registry and method handlers.                                            |
| `src/services/`            | Domain logic that never queries the database: grading, email. Data access: `src/db/`. |
| `src/typing/`              | Type utilities and branded types.                                                     |
| `src/urls/`                | URL parsing and course reference utilities.                                           |
| `src/utils/`               | Utility functions.                                                                    |
| `cli/`                     | The Python CLI, a git subtree. See [CLI](#cli).                                       |

Code that does not read or write the database stays out of `src/db/`, even when
it works on entities: domain rules (grading, exam results) go to
`src/services/`, generic helpers to `src/utils/`.

[^readme]: Currently it exists at `src/api/`, `src/urls/`, `src/commands/`, `test/stories/`.

## Workflow

If human asks for some coding/implementation task, start by planning the
requested feature. It can be planned in a conversation or already documented in
a spec file. To design a new feature from scratch, use the `new-feature` skill.

New technical documents (specs, issues, skills) are written in Portuguese. Code,
identifiers and code comments stay in English. Existing English documents are
not translated.

Analyse the requirements and be explicit about design decisions. Pick what you
think is the best approach and document it. Ask human only if the decision produces 
irreversible consequences (e.g., database migrations, breaking external tools).

If the implementation is not trivial, it is probably better to use the `tdd`
skill in full mode. Confirm with the human before writing code.

Once the spec is ready, implement the feature and the corresponding tests.
Design the tests so it can provide some proof that the implementation is
correct. You can collect screenshots or other evidence to support your claims.
Show them to the human.

Every new feature needs data in the dev server to exercise it. Before calling
a feature done, check that `src/db/bootstrap.ts` seeds examples that reach
each of its states, and add them when it does not. A page that can only be
seen after arranging rows by hand is not finished.

Once completed, move any implemented spec files to `dev/specs/to-review/` and
update the changelog. If you find any bugs, create a new issue in `dev/issues/`.
If the bug is simple, create a regression test and fix it. If it is complex, ask
the human for help.

## Design playground

Never write standalone HTML mockups: prototype in Astro, with the app's own
layouts (`AppLayout`) and components. A change to an existing screen is
prototyped in place, on the real component, against data in `dev.db`. New
screens, and alternatives compared side by side, go to
`src/pages/design/playground/<work>/`, one subfolder per piece of work. Helpers that are not pages take a `_` prefix. The
playground may stay on `main` while a design settles, but `pnpm run release`
refuses to run until only `index.astro` is left there.

## Releases and migrations

The schema evolves with `prisma db push` during development. Never write
migrations by hand or with `prisma migrate dev`: `pnpm run release` writes
one per release, checks it for data loss and runs the gate before tagging.
See "Deploying" in `README.md`. Instance-specific deployment lives in
`deploy/`, a separate repository that git ignores here.

## Linting

Never hand-fix what Biome can fix itself. Auto-fix first, then run the linter as
a final check, and only investigate what survives:

```
pnpm exec biome check --write .   # auto-fix
pnpm run lint                     # final check — must exit 0
```

Both steps are required before calling a task done. `pnpm run lint` is what CI
runs (`.github/workflows/ci.yml`), so a task is not finished while it fails.

Checking only the files you touched is not enough — CI lints the whole project,
so run it project-wide.

`pnpm run lint` is three checks, and Biome is only the first:

```
biome ci .                # style and lint rules
pnpm run typecheck        # tsc --noEmit, then scripts/astro-check.ts for .astro
pnpm run stories --check  # story catalogue against test names
```

Biome does not typecheck. A type error passes `biome ci .` happily, which is how
a broken `canViewCourse` and a broken question fixture both reached `main` while
CI stayed green. If you changed a type, a service signature or a Prisma model,
run `pnpm run typecheck` yourself rather than trusting a green Biome run.

## Development Commands

| Command             | Action                                        |
| :------------------ | :-------------------------------------------- |
| `pnpm run dev`      | Start dev server at `localhost:4321`          |
| `pnpm run build`    | Build for production to `./dist/`             |
| `pnpm run test:unit`| Run the specs that need no server. See below  |
| `pnpm run test:e2e` | Run the specs that drive the server under test|
| `pnpm run test`     | Run both scopes, `unit` first                 |
| `pnpm run lint`     | Run linter, typecheck, and story coverage     |
| `pnpm run manage`   | Run management CLI commands                   |
| `pnpm run db:seed`  | Seed the dev database                         |
| `pnpm run db:reset` | Reset and re-seed the dev database            |

The dev database (`dev.db`) is disposable. Nothing in it is worth keeping: run
`pnpm run db:reset` whenever a schema change or a new seed calls for it,
without asking first. The reset deletes the file, so a dev server that is
running keeps the old one open and fails every write with "attempt to write a
readonly database" until it is restarted. Say so when the server is not yours
to restart.

### Test scopes

The suite has two scopes, and `test/scope.ts` sorts each spec into one by
reading it: a spec that takes the `page`, `request`, `browser` or `context`
fixture, or refers to `TEST_BASE_URL` or `TEST_RUNNER_ORIGIN`, is `e2e`.
Everything else is `unit`.

| Scope  | Specs                                | Runs                                                    | Time   |
| :----- | :----------------------------------- | :------------------------------------------------------ | :----- |
| `unit` | services, schemas, pure functions    | spec files in parallel, one database per worker         | ~30 s  |
| `e2e`  | pages, REST API, user stories        | spec files in parallel, one server and database per worker | ~3 min |

Run them in this order of priority:

1. `rtk pnpm run test:unit` after every change. It is cheap enough to never skip.
2. The `e2e` specs of what you touched, by file, when the change reaches a page,
   an endpoint or an action: `rtk pnpm exec tsx test/run.ts --scope=e2e test/foo.spec.ts`.
3. `rtk pnpm test`, both scopes, once before calling the task done. Not after
   every edit.

Prefer a `unit` spec for a new test: cover the rule in the service and leave to
`e2e` only what needs a browser or the HTTP layer. A `unit` spec gets a copy of
the seeded database per worker, so it must not depend on rows another spec file
left behind. The same holds for `e2e`: each worker has its own server, database
and blobs, and the order between spec files is not fixed.

An `e2e` spec imports `test` and `expect` from `test/fixtures.ts`, not from
`@playwright/test`: its pages wait for the islands to hydrate after `goto` and
`reload`, so a click does not land on markup that has no handler yet. A click
on a link is not covered; wait for something the island renders before acting.

`e2e` runs 4 workers. `TEST_E2E_WORKERS=1` runs one spec file at a time, which
helps to tell a failure of the code from one of timing on a busy machine. Do not
pass `--workers`: the servers are started from `TEST_E2E_WORKERS`.

### Test output

`test/run.ts` wipes the test database and pushes the schema before Playwright
starts, so `playwright test` on its own refuses to run. Everything after the
script name is forwarded to Playwright.

Runs are isolated from each other: the script reserves the first free block of
ports at or above 4322, one per `e2e` worker, and puts that run's blobs and
build under `test/.tmp/<port>/`, so a second run started while one is going does
not wipe the database in use. Set `TEST_PORT` to pin the first port. The
databases themselves go to `/dev/shm` when it exists, and so do the lock files
that keep two runs off the same ports (`/dev/shm/codehood-test-ports/`).

It defaults to `--reporter=dot`, which prints one character per test instead of
one line, and still streams as the suite runs. Pass `--reporter=line` to see
which test is currently running, or `--reporter=list` for the full log.

```bash
rtk pnpm test                                   # whole suite, dot reporter
rtk pnpm exec tsx test/run.ts test/foo.spec.ts  # one file, whichever scope it is in
rtk pnpm exec tsx test/run.ts --scope=unit      # one scope: unit, e2e or all
rtk pnpm test -- --reporter=line                # name each test as it runs
```

While iterating, `--only-changed` runs only the specs affected by uncommitted
changes, and `--only-changed=main` those affected since a ref. Selection takes
about 4 seconds. It follows the imports of each spec, so it covers service and
pure specs well and misses whatever a spec reaches some other way: pages and
endpoints called over HTTP, `.astro` files, `prisma/schema.prisma`, seed data.
An empty selection therefore proves nothing. Run the whole suite before calling
a task done.

```bash
rtk pnpm exec tsx test/run.ts --only-changed       # affected by the working tree
rtk pnpm exec tsx test/run.ts --only-changed=main  # affected since main
rtk pnpm run test:unit --only-changed              # the same, without building the server
```

`TEST_BROWSERS=cross` adds Firefox and WebKit projects that run only the
`runner-*` specs; the default suite stays on Chromium. Install them with
`pnpm exec playwright install firefox webkit`, then pass `--project=firefox`
or `--project=webkit` to the test script.

The runner has two suites outside `pnpm test`, each with its own static
server (no Astro, no database): `pnpm run test:runner` for the core in
`packages/runner/test/` (~20 s), and `pnpm run test:plugins` for the
languages in `src/runner/plugins/<id>/test/` (~1 min; one plugin with
`--project=<id>`). Run them when you touch `packages/runner` or a plugin.
`TEST_BROWSERS=cross` works on `test:runner` too.

`--rtk` runs Playwright through `rtk playwright` instead. Reach for it only on a
suite expected to pass: it reduces a green run to a single `PASS (n) FAIL (0)`
line, but its parser gives up on a red one and passes through 2000 characters of
raw config JSON. The `dot` default reports failures far better, so prefer it
whenever something is actually broken.

## CLI

`cli/` is the Codehood CLI, a Python project (uv, pytest, Textual) with its own
conventions. It is a git subtree of
[codehood-cli](https://github.com/fabiommendes/codehood-cli). Before any work in
`cli/`, or any server change the CLI depends on (REST endpoints, schemas, the
OpenAPI spec), read `cli/README.md` and `cli/CLAUDE.md`. Inside `cli/`, those
files take precedence over this one.

- The CLI takes `mdq` from `../../mdq/mdq-py`, a checkout of
  [mdq-spec](https://github.com/fabiommendes/mdq-spec) next to this repository.
- Run its tests from `cli/` with `rtk uv run pytest`.
- Biome skips `cli/`.
- Sync with the standalone repository only when the human asks:
  `git subtree push --prefix=cli git@github.com:fabiommendes/codehood-cli.git main`
  (or `subtree pull` with the same arguments).

## Documentation

Full astro documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)


## Glossary

Always read the list of definitions in the glossary using:

```bash
 grep -oP "^## \K.+" GLOSSARY.md
```

If you want to fetch the details of a definition, use:

```bash
awk  'BEGIN { IGNORECASE = 1 } /## <TERM>/{flag=1; next} /##/{flag=0} flag' GLOSSARY.md
```

replacing <TERM> with the term you want to look up.

If a new concept or word is introduced in a conversation, ask the human if it
should be added to the glossary. Be extremely succint when adding entries to the
glossary. Add in alphabetical order.

## Validation

Input schemas constrain values, output schemas constrain shape. Keep the
`returns:` validators — they whitelist what leaves a service — but do not
repeat a format rule there that the create/update schema already enforces. See
ADR 0006 (`dev/adr/0006-validacao-de-entrada-e-saida-nos-services.md`).

## Skills

Some installed skills assume a file layout this project does not use. Map them
onto what exists here instead of creating parallel structure:

| Skill expects   | Use instead                                       |
| :-------------- | :------------------------------------------------ |
| `CONTEXT.md`    | `GLOSSARY.md` (terms only, alphabetical, succint) |
| `docs/adr/*.md` | `dev/specs/` (design decisions and rationale)     |

Never create `CONTEXT.md`, `CONTEXT-MAP.md` or `docs/adr/`.


## Coding style

Adopt best practices and some specific rules for this project:

- Never reference the functional requirements or context that can only be 
  understood via the current conversation in comments (documentation comments 
  or otherwise).
- When doc commenting variables, and constants, use `///`. For public functions,
  methods and classes use `/** */`. Private members or internal details use
  `///`. Some functions are marked public only because they belong to a
  sub-module that be re-exported by inner modules and are not actually exposed
  in the public API. Treat those functions as if they were private. Never import
  them directly outside the sibling sub-modules. This hierarchy follows the
  filesystem hierarchy.
- The doc comments for methods, functions and classes follow the structure:
  - A SINGLE sentence describing the purpose and behavior.
  - Any additional details or context, if necessary (it is more often than not, uncessary)
  - A `@example` section demonstrating usage, if the description alone is not 
    sufficient and if the example is self-contained, executable and reasonably 
    simple.
  - A `@params` section ONLY if the usage of each parameter is not already clear
    from the description and type signature.
  - Add a `@throws` section if the function can throw exceptions. 

