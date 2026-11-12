# chalk-worker

A pull worker for [Codehood](https://github.com/fabiommendes/codehood). It runs
on the teacher's machine, claims grading jobs of code questions from the
Codehood server, grades each answer with
[chalk-grader](https://pypi.org/project/chalk-grader/) in a bwrap sandbox, and
sends the score and feedback back with the teacher's `BOT` key.

Use it for questions that need an environment only the teacher has. Linux
only.

Status: scaffold. The loop waits for the grading job queue of the server.

```sh
chalk-worker [--exam <slug> | --discipline <slug>] [--poll 10] [--batch 4] [--once]
```

## Development

The worker lives in the codehood repository as a git subtree in
`workers/chalk-worker/`, and depends on `codehood-cli` from `../../cli`.

```sh
uv run pytest
uv run ruff check
```
