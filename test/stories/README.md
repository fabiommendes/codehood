# Stories Test Cases

This directory contains test cases for stories. Each test case is designed to
verify the functionality and behavior of stories within the application. Tests
are organized in separate files of `<role>-<category>.test.ts`. The roles
and categories match the stories in the `docs/user-stories` directory. 

Each test case is a separate story and it should exercise the application in a
way that simulates the actions of a user with the specified role. That is, open
a web page, click buttons, fill forms, etc. The test case should verify that the
expected outcomes occur as a result of these actions.

Unless the user story explicitly states it, tests should interact with the web
UI, not with the underlying Rest APIs or Astro actions. We can touch the
database service classes to prepare the necessary state for the tests and
consult it afterwards, but user actions should be translated into UI actions and
not performed directly.

## Recommendations

**Arrange with services, act through the UI.** Everything that is merely
background — the course exists, the student is enrolled, an invite was issued —
goes through the service classes with `FULL_ACCESS`, which is fast and says
plainly what the world looked like before the story began. Only the actions the story
attributes to its user are performed on the page. A test that seeds a session
cookie by hand has not tested logging in.

Being signed in is background for almost every story, so `logInAs(page, user)`
mints a session with `sessionService.create` and hands the browser the cookie
`auth.login` would have set. The middleware then validates it by the ordinary
path — there is no test-only header or auth short-circuit in `src/`, which is
the point: a bypass that lives in production code is one deploy away from being
a production hole. Reserve `logIn`, which drives the form, for the stories that
are *about* signing in, and for the moment a story has to prove a credential
still works — after a password change, say.

**Name the test after the story.** Prefix it with the role and use the story
title verbatim, so a failure names the story that broke:

```ts
test("student: log in", async ({ page }) => {
```

`pnpm run stories` slugifies both sides and writes `docs/user-stories/coverage.md`
from the result. `pnpm run lint` runs it with `--check`, which fails when a test
names a story that no longer exists, so renaming a story breaks the build until
its test is renamed too, and `--stale` names the tests that have drifted.
`--missing` lists the stories still waiting for a test, and
`pnpm run stories --missing | grep -v '\[status: todo\]'` narrows that to the
ones whose feature is already built.

One story can carry several tests, but a story split across two tests is usually
a story that should not have been split. A failure path belongs in a
`test.step` inside the story it interrupts, the same way the catalogue writes it.

**Keep fixture data unique.** The database is created once per run, not once per
test: `test/run.ts` wipes the file and pushes the schema before Playwright
starts, and nothing rolls back between tests. Tests also run serially
(`workers: 1`, `fullyParallel: false`), so they see each other's rows. Give every
test its own emails, usernames and slugs — `invitee1@codehood.test`,
`vis-instructor-a` — rather than a shared `test@example.com` that collides on the
second test to use it.

**Assert the promise, not the mechanism.** The story says what the user should
end up seeing; assert that. Checking that a row landed in the database is a
useful supplement when the UI cannot show the difference, but it is never the
whole test — a page that writes correctly and renders nothing still fails the
story.

**Never assert on a class name.** DaisyUI classes are styling, and they change
when the design does. Locate by what the user perceives: a role, a name, a
visible string.

**Do not sleep.** Playwright's assertions retry until they pass or time out, so
`waitForTimeout` only makes a suite slower and flakier. If something needs
waiting for, express it as the assertion you were going to make anyway.


## Running them

Always go through `test/run.ts`. It wipes the database file, pushes the schema
and exports `DATABASE_URL` before Playwright starts:

```sh
pnpm test                                # everything
pnpm exec tsx test/run.ts test/stories/  # one directory
pnpm run test-ui                         # UI mode
```

`playwright test` and `playwright test --ui` skip all of that. `src/db/client.ts`
then falls back to `file:./dev.db` while `playwright.config.ts` still pins the
*server* to the test database, so the factories seed one database and the server
reads another — every story fails as though login were broken, and the writes
land in your real dev database. `test/global-setup.ts` now refuses to start in
that state, but the shortcut is still not worth taking.

Two more ways a run goes wrong before a single assertion is reached. `pnpm test
-- test/stories/` does **not** filter: pnpm eats the `--` and the whole suite
runs. And `reuseExistingServer` is `false`, so a server left behind by an
interrupted run fails the next one with "http://localhost:4322 is already used"
— clear it with `pkill -f "dist/server/entry.mjs"`.

## Playwright primitives

The config sets `baseURL`, so paths are relative and the `url:` field on a story
is usually the first line of its test:

```ts
await page.goto("/login");
```

Locate elements the way a user finds them, in rough order of preference:

```ts
page.getByRole("button", { name: "Log in" });   // the accessibility tree
page.getByLabel("Password");                    // form fields, by their label
page.getByText("You're accepting an invite");   // visible copy
page.getByTestId("course-card");                // last resort, needs data-testid
```

Locators are lazy and strict: nothing is queried until the locator is used, and
one that matches two elements throws rather than silently picking the first.
Narrow with `.filter()`, `.first()`, or by scoping to a container:

```ts
const row = page.getByRole("row").filter({ hasText: "Ada Lovelace" });
await row.getByRole("button", { name: "Drop" }).click();
```

Act with `click()`, `fill()`, `check()`, `selectOption()` and
`setInputFiles()`. Each one auto-waits for the element to be attached, visible
and enabled before it fires.

Assert with the web-first matchers, which retry:

```ts
await expect(page).toHaveURL("/courses");
await expect(page.getByRole("heading", { name: "CS101" })).toBeVisible();
await expect(page.getByRole("listitem")).toHaveCount(3);
await expect(page.getByText("This invite has expired.")).toBeVisible();
```

Use `expect(locator)`, not `expect(await locator.textContent())` — the second
form reads once and cannot retry, which is the usual source of a test that
passes locally and fails in CI.

Group the phases of a longer story with `test.step()`, which also makes the
trace readable:

```ts
await test.step("instructor issues a classroom invite", async () => { ... });
await test.step("student redeems it and lands enrolled", async () => { ... });
```

When several stories need the same logged-in user, sign in once through the form
and reuse the cookies with `storageState` rather than re-typing the login in
every test.

Two notes specific to this project. The `extraHTTPHeaders: { origin }` in
`playwright.config.ts` exists only because the bare `request` fixture omits an
`Origin` header that Astro's CSRF check wants; a real browser sends it, so
`page`-driven tests do not depend on that setting. And the server under test is
a production build (`astro build` plus the Node adapter), not `astro dev`, so
there is no HMR and a change to `src/` needs a fresh run to be visible.

Finally, the forms in this codebase mostly label their inputs with a DaisyUI
`<legend class="fieldset-legend">` and no `<label for>`, which names the
surrounding group rather than the field. `getByLabel("Password")` therefore
finds nothing on `/login` today. Scoping to the group works:

```ts
await page.getByRole("group", { name: "Password" }).getByRole("textbox").fill(pw);
```

but the better fix is usually to give the input a real label in the page, since
a field a screen reader cannot name is a genuine accessibility bug and not just
an inconvenient test. Reaching for `locator("input[name=password]")` hides the
problem instead.
