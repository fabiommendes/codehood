# Codehood [![codecov](https://codecov.io/gh/fabiommendes/codehood/graph/badge.svg?token=glsmeycRAV)](https://codecov.io/gh/fabiommendes/codehood)


Codehood is a simple Learning Management System (LMS) optimized for programmers
and geeky types. As an instructor, you should consider it if you like the idea
of storing your course in plain text files under version control and if you and
your students are comfortable with using it from the command line.

In Codehood, most course material is stored and crafted locally in a Git
repository. The instructor uses a CLI tool to synchronize with the remote server
and make updates and new content available to students. This includes questions,
exams, calendar, downloadable resources, and more.

Students mostly use Codehood as a regular web-based LMS. The CLI is available,
and might be the preferred way for some students, but it is not necessary.

This repository holds the server and, in [`cli/`](cli/), the CLI.


## How does it work?

If you are an instructor, start a new course by running `codehood init`. This
creates the scaffolding that the CLI uses to manage the course and synchronize
with the remote server. See [cli/README.md](cli/README.md) for the layout of a
course repository.

You can edit this content adding or modifying any resource. After the work is
done, run `codehood push` to synchronize the changes with the remote server.
The server never modifies the content, hence there is no `codehood pull`
command.

Once you update a resource, your students will see the changes immediately in their web browser. 


## Preparing the dev environment

You need pnpm and playwright pre-installed. Then, from a fresh clone:

```sh
pnpm run init
```

That installs the dependencies, writes a `.env`, creates and seeds the local
SQLite database and runs the code generators. It is idempotent, so you can
re-run it any time.

Then use one of the following, depending on what you want to do:

| Command              | Action                                      |
| :------------------- | :------------------------------------------ |
| `pnpm run init`      | Set the project up from scratch             |
| `pnpm run dev`       | Start local dev server at `localhost:4321`  |
| `pnpm run build`     | Build your production site to `./dist/`     |
| `pnpm run test`      | Run integration tests                       |
| `pnpm run lint`      | Run linter, typecheck, and story coverage   |
| `pnpm run manage`    | Run management CLI commands                 |
| `pnpm run db:reset`  | Reset the dev database and re-seed          |
| `pnpm run db:seed:cli` | Push the `pyxel101` course with `ch push` |
| `pnpm run clear`     | Reset the project to a freshly-cloned state |

### Configuration

An instance is described by `codehood.config.ts` at the root, validated by
`defineConfig` from `src/config/`. A deployment keeps its own file and points
`CODEHOOD_CONFIG` at it instead of editing this one.

| Key                           | Default               | Meaning                                                                 |
| :---------------------------- | :-------------------- | :---------------------------------------------------------------------- |
| `instance.publicUrl`          | `http://localhost:4321` | Build-time constant. Address of the instance, see [Deploying](#deploying). |
| `instance.locale`             | `en`                  | Build-time constant. One of the `locales` of `project.inlang/settings.json`. |
| `instance.timeZone`           | `America/Sao_Paulo`   | Build-time constant. Zone every instant is rendered in.                  |
| `instance.schoolIdPattern`    | empty (any id)        | Regex over the whole school id, e.g. `[0-9]{9}`.                         |
| `storage.resourceRoot`        | `./storage/resources` | Where resource blobs are written.                                        |
| `storage.attachmentLinkMode`  | `symlink`             | `symlink`, `hardlink` or `copy`.                                         |
| `storage.quota.instructor`    | `1gb`                 | Upload quota per instructor.                                             |
| `storage.quota.student`       | `200mb`               | Upload quota per student.                                                |
| `runner.origin`               | null                  | Build-time constant. Origin of the code runner, see [Code runner origin](#code-runner-origin). |

Build-time constants are baked into the build: a changed value takes effect
with the next `pnpm run build`, and the dev server restarts by itself when the
file changes. The default file writes them as literals. The other keys are
read again at every boot, so the default file takes them from the
environment with `env("NAME", fallback)`, which treats a blank variable as
unset (`SCHOOL_ID_PATTERN`, `RESOURCE_ROOT`, `ATTACHMENT_LINK_MODE`,
`BLOB_QUOTA_INSTRUCTOR`, `BLOB_QUOTA_STUDENT`).

The time zone is not read from `TZ`: that variable also changes the Node
process's own default zone, for anything that skips an explicit `timeZone`.

A dev server on another port needs its own address. Write a file that
extends the default, and point `CODEHOOD_CONFIG` at it:

```ts
// tmp/codehood.4331.config.ts
import { defineConfig } from "@/config";
import base from "../codehood.config";

export default defineConfig({
	...base,
	instance: { ...base.instance, publicUrl: "http://localhost:4331" },
});
```

### Environment variables

Only process settings and secrets stay in the environment.

| Variable          | Required | Default              | Meaning                                                       |
| :---------------- | :------- | :------------------- | :------------------------------------------------------------ |
| `ENVIRONMENT`     | yes      | none                 | `dev`/`development` or `prod`/`production`. The server refuses to boot without it. |
| `DATABASE_URL`    | yes      | `file:./dev.db`      | SQLite database to open.                                       |
| `CODEHOOD_CONFIG` | no       | `codehood.config.ts` | Configuration file, relative to the root.                     |
| `DEBUG`           | no       | `false`              | Verbose error output.                                          |
| `LOG_ENV`         | no       | `false`              | Echo the resolved settings at startup. Set by `pnpm run dev`. |

`ENVIRONMENT` deliberately has no default, and an empty value counts as
unset. It decides two things a deployment cannot afford to get wrong by
omission: whether the demo accounts (`admin`/`admin` and friends) may be
seeded at all, and whether the session cookie is sent with `Secure`. A
production deployment sets `ENVIRONMENT=prod` (or `production`); anything
else fails at startup with a message naming the variable.

An `.env` created before this variable existed will not have it. Add
`ENVIRONMENT="dev"` to it, or copy `.env.example` over.

Demo accounts are never created by a request. They come from
`pnpm run db:seed` (and the test runner), and only when `ENVIRONMENT=dev`.

`pnpm run db:seed:cli` adds a full course, `pyxel101/ada_<edition>`, through the
CLI rather than the services: it copies `cli/seed/pyxel101/` to `tmp/pyxel101/`
and runs `ch push` there as `ada`. The dev server must be running. See
`cli/seed/README.md`.

`pnpm run clear` deletes every generated artifact — `node_modules/`, the Prisma
client, the Astro cache, builds, test output, `dev.db` and the `storage/`
resource blobs — leaving only what git tracks. It keeps `.env` unless you pass
`--all`, and `--dry-run` lists what it would delete. `pnpm run init` brings the
project back afterwards.


## Deploying

A release is a git tag cut from `main`, built on any machine into a tarball
that a server runs with Node and a production `pnpm install`. Nothing is
built on the server, so a small one (1 vCPU, 1 GB) is enough.

```
pnpm run release minor                         # migrations, gate, bump, tag
git push origin main v0.2.0
pnpm run package v0.2.0 --out build/ --config deploy/codehood.config.ts \
  [--rehearse prod-copy.db]
```

- `pnpm run release <patch|minor|major|x.y.z>` writes the migration for the
  schema changes since the last release (`pnpm run db:migrate`), runs the
  gate (`pnpm run lint`, `pnpm test`), bumps `package.json`, dates the
  changelog's "Unreleased" section, then commits and tags `vX.Y.Z`. It stops
  when a migration drops tables or columns; edit the migration to keep the
  data, or pass `--allow-data-loss`.
- `pnpm run package <tag>` builds the tag from a clean export, with the
  instance's configuration file (`--config`) in place of the tag's own. `--rehearse`
  applies the migrations to a copy of a database first, so a migration that
  breaks on real data fails here instead of on the server.
- On the server: unpack, `pnpm install --prod --frozen-lockfile`,
  `pnpm exec prisma migrate deploy`, then run `node dist/server/entry.mjs`
  (`HOST`/`PORT` pick the address) behind an HTTPS reverse proxy that sets
  `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For`. Management
  commands run as `node dist/manage.mjs <command>`.

`pnpm run package` checks `instance.locale` before building and records the
address, locale and time zone in `RELEASE`. Tags older than
`codehood.config.ts` still read `PUBLIC_URL`, `CODEHOOD_LOCALE` and
`SERVER_TZ` from the environment; for newer tags those variables make it
fail. The server trusts the proxy's `X-Forwarded-*` headers only for the
`instance.publicUrl` host; with a wrong one, form posts fail Astro's origin
check and every client has the proxy's IP.

### Code runner origin

The browser runs student code in a frame served from its own origin, so that
code never shares cookies or storage with the app. The same Node process
serves it, under `/runner/`, at the host given by `runner.origin`
(e.g. `https://runner.example.net`).

- A separate registrable domain is the recommended default. A subdomain of the
  app's domain also works, but only with the `__Host-session` cookie, which
  production already uses.
- `runner.origin` must be https and differ from `instance.publicUrl`. Null
  in production, code execution is off: `/runner/` answers 404.
- The reverse proxy **must** restrict the runner host to `/runner/`. Files of
  `public/` and `/_astro/` are answered before the middleware, on any host, so
  only the proxy can keep the runner origin from serving the app's assets.
- The proxy must pass `Host` or `X-Forwarded-Host` with the runner's host;
  without it the server cannot tell the two origins apart.

```nginx
server {
    server_name runner.example.net;
    # TLS as for the app
    location /runner/ {
        proxy_pass http://127.0.0.1:4321;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / { return 404; }
}
```

In development and tests the app runs on `localhost` and the runner on
`127.0.0.1`, which are different sites on the same process.

Migrations are written only at release time. Development keeps using
`prisma db push`, so the history holds one migration per release instead of
one per schema edit.

## Architecture and Tech Stack

The Codehood server is built with [Astro](https://astro.build/). It uses the
following tech stack:

| Layer             | Technology                                                                       |
| :---------------- | :------------------------------------------------------------------------------- |
| Frontend          | [Astro](https://astro.build/)                                                    |
| Rest API          | In-house Astro dynamic endpoints                                                 |
| Database          | [Prisma](https://www.prisma.io/) ORM with SQLite                                 |
| Validation        | [Zod](https://zod.dev/)                                                          |
| Auth              | In-house: Argon2id + session cookies + API keys |
| CSS               | [DaisyUI](https://daisyui.com/) and TailwindCSS                                  |
| Components        | [SolidJS](https://www.solidjs.com/)                                              |
| Integration Tests | [Playwright](https://playwright.dev/)                                            |
| Linter and QA     | [Biome](https://biomejs.dev/)                                                    |


## Project Structure

See the "Project layout" table in `AGENTS.md` for a complete breakdown of directories and their purpose.


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems as described in
[SECURITY.md](SECURITY.md).


## License

The server is licensed under the [GNU Affero General Public License v3.0 or
later](LICENSE). The CLI in `cli/` is licensed under the [MIT License](cli/LICENSE).
