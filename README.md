# Codehood

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

You need pnpm and playwright pre-installed. Then follow the usual ways: 

```sh
pnpm install
```

Then use one of the following, depending on what you want to do:

| Command              | Action                                      |
| :------------------- | :------------------------------------------ |
| `pnpm run configure` | Configure the local environment.            |
| `pnpm run dev`       | Starts local dev server at `localhost:4321` |
| `pnpm run build`     | Build your production site to `./dist/`     |


## Architecture and Tech Stack

The Codehood server is built with [Astro](https://astro.build/). It uses the
following tech stack:

| Layer             | Technology                                                                       |
| :---------------- | :------------------------------------------------------------------------------- |
| Frontend          | [Astro](https://astro.build/)                                                    |
| Rest API          | In-house Astro dynamic endpoints                                                 |
| Database          | [Prisma](https://www.prisma.io/) ORM with SQLite                                 |
| Validation        | [Zod](https://zod.dev/)                                                          |
| Auth              | In-house: Argon2id + session cookies + API keys (see `docs/implemented/auth.md`) |
| CSS               | [DaisyUI](https://daisyui.com/) and TailwindCSS                                  |
| Components        | [SolidJS](https://www.solidjs.com/)                                              |
| Integration Tests | [Playwright](https://playwright.dev/)                                            |
| Linter and QA     | [Biome](https://biomejs.dev/)                                                    |


## Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.png
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

