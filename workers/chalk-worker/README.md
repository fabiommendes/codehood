# chalk-worker

A pull worker for [Codehood](https://github.com/fabiommendes/codehood). It runs
on the teacher's machine, claims grading jobs of `code` questions (mdq) from
the Codehood server, runs the test sources of each question against the answer
with [chalk-grader](https://github.com/fabiommendes/chalk) in a bwrap sandbox,
and sends back an mdq runner report with the teacher's `BOT` key. The server
scores the report by the rubric of the question.

Use it for questions that need an environment only the teacher has. Linux
only. Languages: Elm (`elm-test`; needs `node`, `elm` and `elm-test`).

```sh
CODEHOOD_BOT_KEY=<key> chalk-worker [--server <url>] [--worker elm-test]
    [--exam <slug> | --discipline <slug> | --course <discipline>/<user>_<edition>]
    [--poll 10] [--batch 4] [--lease 120] [--once]
```

Inside a course folder, the server and the course come from `codehood.toml`.
`--once` grades what is queued and exits. `SIGINT`/`SIGTERM` finish the job in
progress and give the others back.

How a job is graded:

1. The question arrives resolved in the job: test sources, `file` and the
   answer key. The first job of each question builds the project (Elm: an
   `elm.json` with the packages of the browser runner, one test module per
   source), fills the package cache and runs the reference solution, which
   must pass every test.
2. The answer is graded with the profile of its `language`. Each JUnit case
   is located in the sources (`source`, `line`) so the server can tell which
   rubric item owns it; a case not found is left out of the report.
3. A build error is a `build-error` report (compiler output without the
   progress lines and the worker's paths), a timeout of the run times out
   every case, and a failure of the infrastructure calls `fail` so the job
   returns to the queue. A run that leaves no test report is graded again
   with the reference solution: when that still passes, the answer crashed
   the test runner (e.g. `Debug.todo` in a top-level value) and every case
   is an `error`; otherwise it is a failure of the infrastructure.
4. When the project cannot be built (a package download fails, a tool is
   missing), the batch goes back to the queue without spending its retries
   and the worker waits before claiming again; `--once` stops there. A
   reference solution that fails a test spends the retries of every job of
   the question, so the instructor sees them as failed.

Test sources of an Elm question may be written as examples instead of a test
module: a fenced block (no `origin`) of format `elm` with no `module` header.
A linked file, or a block of another format, with no `module` header is an
error of the question. One line per case, in this order:

- an `mdq:` annotation line (same rule as the MDQ lexer) is a rubric item
  with its regions, feedback and `{public}`/`{example}`;
- blank lines and lines with only a `--` comment are ignored;
- `import X` lines, only before the first case, are copied to the generated
  module;
- `expr ==> value` is `Expect.equal`, and `expr ~= value` is `Expect.within`
  with an absolute or relative tolerance (`1.0e-9`, `1.0e-6`), for scalar
  `Float` only. An inline `-- comment` (outside string and character
  literals) goes into the test name. Exactly one operator per line;
- anything else, including `{- -}` comments, is an error.

The test name is `expr ==> value (comment)`, normalized to one space around
the operator, and must be unique in the block. Lines are split only on `\n`,
`\r` and `\r\n`. Cases before the first annotation fall in a hidden implicit
item. The generated module is `Examples<i>` (`i` is the index of the source),
exposes `tests` (`Test.concat`, no `describe`) and imports the answer as
`exposing (..)`; the answer module is `file` without `.elm`, `/` replaced by
`.`. `Examples<i>` must not collide with the answer module or another source.
An invalid block fails the question (with the line number), never the
student. An answer with no `module` header gets
`module <Answer> exposing (..)` prepended, which shifts the line numbers of
compiler errors by two. The format has a twin in TypeScript in codehood
(`src/services/elm-examples.ts`); both run
`tests/resources/elm-examples-cases.json`.

Caches live in `$XDG_CACHE_HOME/chalk-worker`.

## Development

The worker lives in the codehood repository as a git subtree in
`workers/chalk-worker/`, and depends on `codehood-cli` from `../../cli` and
on `chalk-grader` from PyPI.

```sh
uv run ruff check && uv run pytest
```

The Elm tests download packages on the first run and are skipped without
`elm`, `elm-test` and `node`. `example/` holds a course with one question.
