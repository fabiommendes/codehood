# Example course

A Codehood course with one `code` question in Elm, graded by the worker.
`tests/test_example.py` checks that the reference solution passes every
test. To grade it against a dev server that seeded the same question:

```sh
CODEHOOD_BOT_KEY=<key> uv run chalk-worker --server http://localhost:4321 --once
```
