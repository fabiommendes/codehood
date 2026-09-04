# `password.ts`'s bare `require("wildleek")` crashes any non-Vite/non-Astro entry point

**Severity:** Low (the real app never hits this; only alternate execution paths do)
**Location:** `src/auth/password.ts:4`

```ts
import { hash, verify } from "@node-rs/argon2";
import * as COMMON_PASSWORDS from "./common-passwords.json";

const passwordInTheWild = require("wildleek");
```

Found while writing a standalone `tsx` script to verify `api-key.service.ts` (see the
"Changed" entry for it in `CHANGELOG.md`) — importing anything that transitively imports
`user.service.ts` → `password.ts` under plain `tsx`/Node ESM fails immediately:

```
ReferenceError: require is not defined in ES module scope, you can use import instead
    at src/auth/password.ts:4:27
```

This is a separate symptom from `dev/issues/password-common-words-build-crash.md` (that one
is about the `COMMON_PASSWORDS` namespace-object import breaking once *built*; this one is
about the file mixing `import` and a bare `require()`, which only Vite's bundler papers over
via its CJS interop — plain Node ESM never has a global `require`). The real app never crashes
on this because it only ever runs through Astro/Vite's build. It bit a `tsx`-based verification
script directly (worked around there by inserting a user row via `prisma.user.create(...)`
directly instead of going through `userService`/`password.ts`), and would bite any future CLI
script, migration, or test runner that imports `user.service.ts` outside the Vite pipeline.

**Suggested fix:** `import passwordInTheWild from "wildleek"` (or the package's documented ESM
entry point), consistent with every other import in the file. Not fixed here since it's outside
this session's scope and unrelated to the change that surfaced it.
