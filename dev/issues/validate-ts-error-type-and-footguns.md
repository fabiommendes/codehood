# `validate.ts`: non-Error throws, and an easy-to-hit `async` footgun

**Severity:** High (error type) / Medium (footgun) / Low (opts guard)
**Location:** `src/utils/validate.ts`

These are independent of the parameter-decorator wiring bug and the Playwright-transform crash
(both fixed — see `CHANGELOG.md`'s "Fixed" entries; `@Arg` no longer exists, replaced by
`@Validate`'s `args:` option). `pnpm test` now actually runs the whole suite, and both bugs
below are directly observable there:

- Bug #1 (non-`Error` throw) fails `test/validate.spec.ts`'s "the thrown return-validation
  error is an Error instance" and "(async: true) validates async return values", and
  `test/user-service.spec.ts`'s "update() rejects any attempt to smuggle in a username change"
  (that one also needed `userUpdate` to be `.strict()` to reject unexpected keys at all — see
  `CHANGELOG.md` — but still fails on this bug: the rejection value isn't an `Error`, so
  `.rejects.toThrow(/username/i)` can't match against it).
- Bug #2 (async footgun) is exercised (as a documented footgun, not a fix) by
  `test/validate.spec.ts`'s "FOOTGUN: ..." test, which now runs and passes as expected.

## 1. Validation failures throw a plain object, not an `Error`

`runFunction`, `runFunctionAsync` (lines ~125, ~138) and `validateArgs` (line ~184) all do:

```ts
throw z.treeifyError(validationResult.error);
```

`z.treeifyError()` returns a plain `{ errors, properties }` object, not an `Error`. Confirmed:

```ts
try { /* trigger a returns-schema failure */ }
catch (e) { e instanceof Error } // false
```

This breaks anything that assumes thrown validation failures are `Error`s: `error.stack` is
unavailable, generic `catch (e) { log(e.message) }` patterns log `undefined`, and centralized
error-handling middleware that branches on `instanceof Error` won't recognize these. It's also
inconsistent with `@Arg`'s own (currently inert) validation code, which correctly does
`throw new Error(...)`. The code even has `// TODO: which validation error we use?` at both
sites — this was left unresolved deliberately.

**Suggested fix:** wrap in a real `Error` (or a dedicated `ValidationError extends Error`),
e.g. `throw new ValidationError(z.treeifyError(validationResult.error))`, keeping the
treeified detail as a property.

## 2. Forgetting `async: true` on an async method with `returns` validates the pending `Promise`, not the resolved value

`ValidateOptions.async` has to be manually kept in sync with whether the decorated method is
actually `async`. Nothing enforces this. If it's left `false` (default) on a method that *is*
async:

```ts
class Plain {
  @Validate({ returns: z.string().min(3) }) // missing async: true
  async method(): Promise<string> { return "this is plenty long"; }
}
new Plain().method(); // throws synchronously — validates the Promise object, not "this is plenty long"
```

`runFunction` (the sync path) calls `originalMethod.apply(...)`, gets back a `Promise`, and
validates *that* against the schema — which fails for virtually any real schema, and throws
synchronously instead of returning a promise the caller can `await`/`catch` normally. This is
silent and easy to introduce (it type-checks fine; nothing about the method's real
`Promise<T>` return type is cross-checked against `options.async`).

**Suggested fix:** detect this instead of trusting the flag — e.g. always check whether
`originalMethod` result is thenable and await it before validating (removing the need for the
`async` option entirely), or at minimum warn if `result` looks like a Promise but
`options.async` wasn't set.

## 3. `service: true` mode trusts `args[args.length - 1]` as `ServiceOpts` with no guard

```ts
const opts = args[args.length - 1] as ServiceOpts;
```

If the method is ever called with fewer arguments than declared — nothing in JS prevents this
at runtime, and it's not a schema-shaped input `@Arg` would catch — this silently treats
whatever *was* the last argument as `opts` instead of failing clearly. E.g.
`service.create("abc")` (opts omitted) treats `"abc"` as `opts`; `"abc".skipValidation` is just
`undefined`, so it proceeds instead of erroring.

**Suggested fix:** a small runtime guard — e.g. check `opts && typeof opts === "object" &&
"actor" in opts` — and throw a clear "missing ServiceOpts" error otherwise, rather than
silently misinterpreting the wrong argument.

## Regression tests

`test/validate.spec.ts` covers #1 and #2 (`"the thrown return-validation error is an Error
instance"` and the `"FOOTGUN: ..."` test). It could not be run via `pnpm test` due to
`dev/issues/arg-decorator-breaks-playwright-test-transform.md`; verified via a standalone
`tsx` harness instead. #3 was verified the same way but isn't encoded as a spec-file test
since it's a minor robustness gap, not incorrect documented behavior.
