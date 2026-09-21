# Codehood [![codecov](https://codecov.io/gh/fabiommendes/codehood/graph/badge.svg?token=glsmeycRAV)](https://codecov.io/gh/fabiommendes/codehood)


Codehood is a simple Learning Management System (LMS) optimized for programmers
and geeky types. As an instructor, you should consider it if you like the idea
of storing your course in plain text files under version control and if you and
your students are comfortable with using it from the command line.

In Codehood, most course material is stored and crafted locally in a Git repository. The instructor uses a CLI tool to syncronize with the remote server
and make updates and new content available to students. This includes questions, 
exams, calendar, downloadable resources, and more.

Students mostly use Codehood as a regular web-based LMS. The CLI is available,
and might be the prefered way for some students, but it is not necessary.


## How does it work?

If you are an instructor, start creating a new course by running the `codehood init`. This will create the scaffolding that the CLI uses to manage the course
and syncronize with the remote server. 

Each course will look something like this:

```text
course/
├── codehood.toml
├── content/
│   ├── calendar/
│   ├── exams/
│   ├── questions/
│   └── resources/
└── README.md
```

You can edit this content adding or modifying any resource. After the work is
done, fire `codehood push` to syncronize the changes with the remote server.
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
| `pnpm run clear`     | Reset the project to a freshly-cloned state |

### Environment variables

| Variable                 | Required | Default              | Meaning                                                       |
| :----------------------- | :------- | :------------------- | :------------------------------------------------------------ |
| `ENVIRONMENT`            | yes      | none                 | `dev` or `prod`. The server refuses to boot without it.        |
| `DATABASE_URL`           | yes      | `file:./dev.db`      | SQLite database to open.                                       |
| `RESOURCE_ROOT`          | no       | `./storage/resources`| Where resource blobs are written.                              |
| `ATTACHMENT_LINK_MODE`   | no       | `symlink`            | `symlink`, `hardlink` or `copy`.                               |
| `BLOB_QUOTA_INSTRUCTOR`  | no       | `1gb`                | Upload quota per instructor.                                   |
| `BLOB_QUOTA_STUDENT`     | no       | `200mb`              | Upload quota per student.                                      |
| `DEBUG`                  | no       | `false`              | Verbose error output.                                          |

`ENVIRONMENT` deliberately has no default, and an empty value counts as
unset. It decides two things a deployment cannot afford to get wrong by
omission: whether the demo accounts (`admin`/`admin` and friends) may be
seeded at all, and whether the session cookie is sent with `Secure`. A
production deployment sets `ENVIRONMENT=prod`; anything else fails at startup
with a message naming the variable.

An `.env` created before this variable existed will not have it. Add
`ENVIRONMENT="dev"` to it, or copy `.env.example` over.

Demo accounts are never created by a request. They come from
`pnpm run db:seed` (and the test runner), and only when `ENVIRONMENT=dev`.

`pnpm run clear` deletes every generated artifact — `node_modules/`, the Prisma
client, the Astro cache, builds, test output, `dev.db` and the `storage/`
resource blobs — leaving only what git tracks. It keeps `.env` unless you pass
`--all`, and `--dry-run` lists what it would delete. `pnpm run init` brings the
project back afterwards.


## Architecture and Tech Stack

The Codehood server is built with [Astro](https://astro.build/). It uses the
following tech stack:

| Layer             | Technology                                                                       |
| :---------------- | :------------------------------------------------------------------------------- |
| Frontend          | [Astro](https://astro.build/)                                                    |
| Rest API          | In-house Astro dynamic endpoints                                                 |
| Database          | [Prisma](https://www.prisma.io/) ORM with SQLite                                 |
| Validation        | [Zod](https://zod.dev/)                                                          |
| Auth              | In-house: Argon2id + session cookies + API keys (see `dev/specs/to-review/auth.md`) |
| CSS               | [DaisyUI](https://daisyui.com/) and TailwindCSS                                  |
| Components        | [SolidJS](https://www.solidjs.com/)                                              |
| Integration Tests | [Playwright](https://playwright.dev/)                                            |
| Linter and QA     | [Biome](https://biomejs.dev/)                                                    |


## Project Structure

See the "Project layout" table in `AGENTS.md` for a complete breakdown of directories and their purpose.
