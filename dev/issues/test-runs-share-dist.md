---
type: note
status: active
tags: [testing, playwright, test-isolation, astro-build]
relatedTo: [test-run, playwright-config]
---

# Concurrent test runs share `dist/`

`test/run.ts` gives each run its own port, database and blob directory
(`test/.tmp/<port>/`), but the web server in `playwright.config.ts` runs
`astro build && node dist/server/entry.mjs` into the shared `dist/`. A second
run's build replaces the chunks the first run's server is loading, and its page
tests fail with `ERR_MODULE_NOT_FOUND dist/server/chunks/...`.

Service-only specs are unaffected because they never hit the server.

Fix: build into a per-run directory, e.g. `astro build --outDir
test/.tmp/<port>/dist`, and start `entry.mjs` from there.
