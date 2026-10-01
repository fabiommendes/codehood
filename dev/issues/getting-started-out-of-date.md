---
type: note
status: active
tags: [cli, getting-started, onboarding, copy]
relatedTo: [cli, api-key]
---

# The getting-started page does not match the CLI

`src/pages/getting-started.astro` (linked as "Set up the CLI" in the user
menu) describes a CLI that no longer exists:

- It never says how to install the CLI. Today that is cloning `codehood` and
  `mdq-spec` side by side and running `uv tool install --editable
  codehood/cli` (see `cli/README.md`).
- Its `codehood init` transcript creates `content/`. The real command asks
  for the discipline, instructor, edition and server, and writes
  `questions/`, `exams/`, `resources/`, `calendar.md` and `codehood.toml`.
  Question files end in `.mdq`, not `.q.md`.
- It leaves out `codehood login`, which trades a login and password for a
  CLI API key. Generating a key on the page becomes the alternative, not a
  required step.
- Students see the page too, but every step is written for instructors
  ("live for your students"), and `cli/README.md` has nothing for students
  yet.

Fix: rewrite the steps as install, `codehood login` (or a key from the
page), `codehood init`, edit the course files, `codehood push`, with the
terminal text copied from the real CLI. Decide what a student gets: no
"Set up the CLI" link and a redirect, or a short note that the CLI is for
instructors for now.
