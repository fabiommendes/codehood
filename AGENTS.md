# Codehood

Codehood is a simple Learning Management System (LMS) optimized for programmers
and geeky types. In Codehood, most course material is stored and crafted locally and syncronized with the server using a CLI tool. This project only includes the
server component and it interacts with the CLI via a REST API.

The server is built with Astro, SolidJS and DaisyUI for the frontend. The database
is managed with Prisma ORM and SQLite. All database tables have Service classes
that abstract the database access. Astro Actions and the Rest endpoints
are only thin layers around those services.

## Project layout

Here are some files and folders agents might be interested in:

| File                    | Description                                                                       |
| :---------------------- | :-------------------------------------------------------------------------------- |
| `README.md`             | Generic description and guidelines.                                               |
| `ROADMAP.md`            | Roadmap and future plans. Very brief descriptions of upcoming features.           |
| `AGENTS.md`             | This file. Guidelines for agents.                                                 |
| `prisma/schema.prisma`  | Database schema.                                                                  |
| `docs/design/*.md`      | Design and specification documents.                                               |
| `docs/specs/*.md`       | Detailed guidelines for implementation of specific features.                      |
| `docs/issues/*.md`      | Store issues and bugs. Once fixed, register in the changelog and delete the file. |
| `docs/implemented/*.md` | Once implemented, specs are moved here.                                           |
| `src/api/`              | Implements controllers for the REST API.                                          |
| `src/actions/`          | Implements Astro Actions.                                                         |
| `src/db/`               | Implements the database schema and services.                                      |
| `src/components/`       | Reusable UI components.                                                           |
| `src/data/`             | Data types used throughout the project. Domain modelling.                         |
| `src/i18n/locales/`     | Localization files.                                                               |
| `src/pages/`            | Astro pages.                                                                      |
| `src/layouts/`          | Astro layouts.                                                                    |
| `src/auth/`             | Authentication and authorization. Permission rules.                               |
| `src/middleware/`       | Middleware for Astro and the REST API.                                            |
| `src/services/`         | Services that implement the business logic and expose resources.                  |
| `src/utils/`            | Utility functions.                                                                |
| `src/commands/`         | Management CLI commands.                                                          |


## Workflow

Start by planning a feature. It can be planned in a conversation or already
documented in a spec file. If it is not documented, create a new spec file in
`docs/specs/` and write down the requirements and design decisions.

Analyse the requirements and be explicit about design decisions. Pick what you
think is the best approach and document it. Ask human only if the decision produces 
irreversible consequences (e.g., database migrations, breaking external tools).

Once the spec is ready, implement the feature and the corresponding tests. Design
the tests so it can provide some proof that the implementation is correct. You
can collect screenshots or other evidence to support your claims. Show them
to the human.

Once completed, move the spec file to `docs/implemented/` and update the
changelog. If you find any bugs, create a new issue in `docs/issues/`. If the
bug is simple, create a regression test and fix it. If it is complex, ask the
human for help.

## Astro Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full astro documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
