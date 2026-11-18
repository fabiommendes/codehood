# Elm runner plugin

Elm in the client runner: REPL and tests only. No `Browser`, DOM or
graphical programs.

## Compiler

The compiler is [Guida](https://github.com/guida-lang/compiler) (`guida` on
npm, BSD-3-Clause), a port of the Elm 0.19.1 compiler written in Elm and
compiled to JavaScript. Its `bin/guida.min.js` carries the whole `elm repl`
loop (`Elm.Terminal.Main`) and prints `value : Type` like the original.
`runtime.ts` wraps that classic script into an ES module.

Rejected:

- the elm.run REPL: the Haskell compiler in WASM, 3.9 MB, no license,
  unmaintained since 2024;
- the guide.elm-lang.org REPL: compiles on a server.

## No network

Guida does every file, stdin and process operation through XHR requests to a
mock server, which its own launcher answers with Node. `host.ts` answers the
same requests from an in-memory file system (`fs.ts`) by replacing the global
`XMLHttpRequest` inside the Worker, only while a Guida command runs. Nothing
leaves the Worker: `all-packages/since/*` gets `[]`, any other URL gets an
empty body and `elm: network access is disabled (<url>)` on stderr. The
status is always 200, because Guida treats any other status as an internal
failure.

The project `elm.json` belongs to the driver (`project.ts`), with a fixed
package list. A student's `elm.json` is ignored and no package can be
installed.

## Package cache

Without a package cache and a project cache (`guida-stuff/`), Guida resolves
dependencies again and makes requests. `build.ts` and `cache.ts` produce both
at build time, offline: Guida runs in Node on the same `MemFs`, and the fake
registry answers from the package sources committed under `packages/`
(refreshed by hand with `scripts/fetch-elm-packages.ts`, the only step that
uses the network). Only `artifacts.dat` is kept; sources, `docs.json` and
package READMEs are left out.

The build is reproducible: mounted files share a fixed mtime
(`MOUNTED_MTIME`) and the build clock is a counter, so two builds with the
same inputs give the same bytes, and the driver reuses the artifacts without
resolving again. The result is cached under the hash of its inputs.

Everything goes into one file, `elm-cache.bin` (`ELM_CACHE_FILE`), emitted
into the versioned bundle next to the driver, not under `/runner/rt/`. The
bundle version is a hash of its content, so the URL changes with the cache
and the server keeps no separate list.

## Test runner

The report uses the `node-test-runner` formatter (BSD-3, as copied by Guida),
renamed to `Codehood.Test.*` under `support/`. `Codehood.Test.Runner` waits
for its seed on the `start` port instead of running in `init`: a port command
sent from `init` goes out before JavaScript can subscribe to the port.
