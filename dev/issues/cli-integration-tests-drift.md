---
type: note
status: active
tags: [cli, testing, integration, openapi]
relatedTo: [cli, openapi-snapshot]
---

# CLI integration tests fail against the dev server

The 7 tests skipped by default in `cli/` (`--run-integration`) all fail
against a live dev server. None of the failures involve mdq.

`tests/test_api_integration.py` (4 failures):

- `GENERATED_CLIENT_PATH` still points at `src/codehood_cli/api/generated.py`;
  the package moved to `codehood/`.
- `codehood.api.generated` has no `get_health` or `ApiError`, which the tests
  expect.
- `resources/openapi/codehood.json` is stale compared with the live
  `/openapi.json`.

`tests/test_push_integration.py` (3 failures, opt in with
`CODEHOOD_RUN_DESTRUCTIVE_PUSH_TEST=1`): `ch push` exits 1 because the
server's resource listing has no `ref` field, while the generated `Resource`
model requires it.

Fix: refresh the snapshot (`scripts/copy-openapi.py`), regenerate
`api/generated.py`, then update the tests to the current package layout and
client API.
