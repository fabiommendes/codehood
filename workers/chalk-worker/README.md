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
    [--jobs N] [--memory 512MiB] [--memory-reserve 512MiB]
    [--poll 10] [--lease 120] [--once] [--tui/--no-tui]
```

Inside a course folder, the server and the course come from `codehood.toml`.
`--once` grades what is queued and exits.

The worker grades `--jobs` answers at once (default: the number of cores),
each in a thread that runs the profile's tools. It claims only as many jobs
as it has free slots (at most `--batch` per claim), so no claimed job waits
for a slot while its lease runs out; the lease is renewed from the claim on.
Each question is prepared once, by the first job that needs it; the other
jobs of the question wait for it. A cache directory serves one worker at a
time: a second worker on the same `--cache-dir` refuses to start.

`--memory` is the memory of each run of a job (default 512 MiB; the build
and the tests are runs of their own). It is also the budget of the job when
starting jobs: a job starts only while the available memory of the machine
(`MemAvailable`), less `--memory-reserve`, holds it on top of the budgets of
the jobs in progress, so the slots in use shrink when memory runs short.
`--memory 0` leaves the profile's default (512 MiB in Elm) and does not look
at the available memory.

### Limits of the runs

With a delegated cgroup v2, each run gets a cgroup of its own (chalk-grader
0.3 or later): `memory.max` is `--memory`, without swap, with a process limit,
and the whole run is killed when it goes past them, without touching the
worker or the other runs. An answer that allocates without end gets
`resource-limit` in every case, with "The answer used more than N MiB of
memory.". In Elm, `--memory` is also node's heap, and `elm-test` runs with one
worker thread, since the worker already grades one answer per core.

The worker gets the cgroup by running itself again, on start, under
`systemd-run --user --scope -p Delegate=yes`, so it needs the systemd of the
user. A desktop session has it. Over ssh, it lives only while the user has a
session, unless lingering is on:

```sh
loginctl enable-linger $USER
```

The worker says which case holds when it starts (in the log, or in the title
of the UI: `run limits on` or `NO run limits`). Without the systemd of the
user (ssh without lingering, cron, a container) or without cgroup v2, runs
have no memory or process limit: the budget is only node's heap in Elm, so
an answer that allocates without end crashes node and errs every case, and
the other processes of a run are not limited. There is no `RLIMIT_AS`
fallback: node does not start with an address space below about 1.4 GiB.

When the system's OOM killer (not the run's own limit) kills a run twice,
or the run cannot be started in its cgroup, the answer is not graded: the job
goes back to the queue spending one of its retries, the log says why, and,
after an OOM kill, the worker waits before claiming again. Do not run the
worker inside a `systemd-run --scope -p MemoryMax=...`: when that scope runs
out of memory, systemd stops all of it, the worker included.

On a terminal the worker shows a UI ([Textual](https://textual.textualize.io/))
with the slots, the jobs finished and the log; `p` pauses and resumes the
claims, `q` stops claiming and quits after the jobs in progress (again to
abort). With `--once` the UI stays open when the queue is empty, until `q`.
`--no-tui` logs lines to stderr instead, where `SIGINT`/`SIGTERM` finish the
jobs in progress and exit.

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
   is an `error`; otherwise it is a failure of the infrastructure. A run
   that goes past its memory is `resource-limit` in every case (see Limits
   of the runs).
4. When the project cannot be built (a package download fails, a tool is
   missing), the jobs of the question go back to the queue without spending
   their retries and the worker waits before claiming again; `--once` stops
   claiming there. The same holds when the system kills the run of the
   reference solution. A reference solution that fails a test, or that goes
   past `--memory`, spends the retries of every job of the question, so the
   instructor sees them as failed.

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
`elm`, `elm-test` and `node`. The tests of the cgroups (`tests/test_cgroup.py`)
need a delegated scope and the pytest of the virtualenv, not `uv run` (uv
would share the scope):

```sh
systemd-run --user --scope --quiet --collect -p Delegate=yes \
    .venv/bin/python -m pytest tests/test_cgroup.py
```
 `example/` holds a course with one question.
