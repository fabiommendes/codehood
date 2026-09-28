# Contributing to Codehood

Thank you for your interest in Codehood. This document explains how the
repository is organized and how to propose a change.

## Repositories

| Directory | Contents                                    | Stack                              |
| :-------- | :------------------------------------------ | :--------------------------------- |
| `/`       | The server: web interface and REST API      | Astro, SolidJS, Prisma and SQLite  |
| `cli/`    | The `codehood` command line client          | Python, uv, Typer and Textual      |

`cli/` is also published on its own as
[codehood-cli](https://github.com/fabiommendes/codehood-cli), as a
[git subtree](https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging#_subtree_merge).
Work in this repository and open issues and pull requests here. The standalone
repository only mirrors `cli/`.

The CLI reads questions with [mdq](https://github.com/fabiommendes/mdq-spec),
which it expects in a checkout next to this repository:

```sh
git clone https://github.com/fabiommendes/codehood.git
git clone https://github.com/fabiommendes/mdq-spec.git mdq
```

## Setting up

- Server: see "Preparing the dev environment" in [README.md](README.md).
- CLI: run `uv sync` in `cli/`. See [cli/README.md](cli/README.md).

## Before you open a pull request

Run the same checks CI runs:

```sh
pnpm run lint          # Biome, typecheck and story coverage
pnpm test              # Playwright integration tests
cd cli && uv run pytest
```

For a large change, open an issue first to discuss the design. A change to the
REST API usually touches both the server and the CLI, and can land in a single
pull request.

## License

Contributions to the server are licensed under the AGPL-3.0-or-later, and
contributions to `cli/` under the MIT License, the same terms as the code they
change.

## Conduct

This project follows a [code of conduct](CODE_OF_CONDUCT.md). Report security
problems as described in [SECURITY.md](SECURITY.md), not in a public issue.
