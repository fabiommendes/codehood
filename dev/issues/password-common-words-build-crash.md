# Built server crashes on startup: `common-passwords.json` import breaks under `astro build`

**Severity:** Critical (blocks `pnpm test` entirely) — but **unrelated** to `src/utils/validate.ts`,
found only because it blocks `pnpm test`'s `webServer` while trying to validate that file.

**Location:** `src/auth/password.ts`

## What's wrong

```ts
import * as COMMON_PASSWORDS from "./common-passwords.json";
...
const PASSWORD_COMMON_WORDS = buildCommonWordsSet(COMMON_PASSWORDS);
```

Under `pnpm test` (`astro build && node dist/server/entry.mjs`), any route that imports
`user.service.ts` (which imports `password.ts`) crashes at import time:

```
[ERROR] TypeError: words is not iterable
    at buildCommonWordsSet (.../user.service_....mjs:66:19)
```

`import * as X from "./file.json"` binds `X` to the module namespace object once bundled
(rather than the JSON array directly, which is what `buildCommonWordsSet(words: string[])`
expects), so `for (let word of words)` fails. Because this fires on server startup / first
import, the `webServer` Playwright waits on never becomes ready and every `pnpm test` /
`pnpm test-e2e` run times out after 60s with `Error: Timed out waiting 60000ms from
config.webServer.` — regardless of which spec file is targeted.

**Suggested fix:** `import COMMON_PASSWORDS from "./common-passwords.json"` (default import) or
`import commonPasswords from "./common-passwords.json" with { type: "json" }`, whichever
matches the project's module/JSON-import convention elsewhere.

Flagging this rather than fixing it directly since it's outside the scope of the
`validate.ts` review that surfaced it, and touching JSON import semantics could have
side effects worth the human's sign-off.
