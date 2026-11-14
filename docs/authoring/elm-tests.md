# Elm tests in a code question

The `## [tests]` section of an Elm code question takes test sources of two
kinds. The same sources run as pretests in the student's browser and as the
grading tests in the worker.

| Kind           | How you write it                                       | Good for                          |
| :------------- | :----------------------------------------------------- | :-------------------------------- |
| Module         | A full `elm-test` module, inline or linked (`[x](X.elm)`) | Property tests, fuzzers, helpers |
| Examples block | A fenced `elm` block with no `module` header           | One expression per case           |

A source is an **examples block** only when it is a fenced block of format
`elm` without a `module` header. A linked file is always a module: if it has no
`module` header, the question is refused. A fence of another format without a
header is an error too.

## Modules

A module exposes `tests` and imports the answer by its module name. The
worker's `suite` is not used.

```elm
module XPublic exposing (tests)

import Expect
import Main as S
import Test exposing (Test, describe, test)

-- mdq: [0] {example} Examples from the statement

tests : Test
tests =
    describe "Examples"
        [ test "empty list" <| \_ -> Expect.equal 0 (S.media [])
        ]
```

## Examples blocks

```elm
import Dict

-- mdq: [0] {example} Examples from the statement
collatzLength 5 ==> 6
collatzLength -42 ==> 0 -- negative numbers have length zero

-- mdq: [+2] {public} Average
media [ 7, 8 ] ~= 7.5

-- mdq: [+3] Long sequences
collatzLength 27 ==> 112
```

### Line rules

Lines split only on `\n`, `\r` and `\r\n`. Each line is classified in this
order:

1. An annotation (`-- mdq: ...`): a rubric item, see below.
2. A blank line: ignored.
3. A comment alone on the line (`--` after spaces): ignored.
4. `import ...`: allowed only before the first case, and copied to the
   generated module. An `import` after a case is an error.
5. A case. The inline comment is removed first (the first `--` outside string
   and character literals). What is left needs exactly one operator outside
   literals, with text on both sides:
   - `expr ==> value` becomes `Expect.equal (value) (expr)`.
   - `expr ~= value` becomes
     `Expect.within (Expect.AbsoluteOrRelative 1.0e-9 1.0e-6) (value) (expr)`:
     absolute tolerance `1e-9`, relative `1e-6`.
6. Anything else is an error. `{- -}` block comments are not supported, and
   `f 1 --> 2` reads as `f 1` plus a comment, so it has no operator.

### Case names

The student sees `expr ==> value`, trimmed, with one space around the
operator. An inline comment is appended: `expr ==> value (comment)`. With `~=`
the operator changes and the rest is the same. Two cases with the same name are
an error.

### Generated module

Named `Examples<i>` (`i` is the index of the source in `tests`), exposing
`tests : Test.Test`. It imports `Expect`, `Test` and the answer module
(`exposing (..)`), plus the block's imports. The answer module is the question
`file` without `.elm` and with `/` as `.`: `Main.elm` is `Main`, `Foo/Bar.elm`
is `Foo.Bar`.

### Floats

`Expect.equal` and `==>` on a bare `Float` are refused by elm-test, since
equality of floats is not reliable. Use `~=` for a scalar `Float`. It does not
apply to lists or records of floats: compare those with a module.

## Rubric annotations

`-- mdq:` lines work as in any mdq test source (see the code question's
annotations in the mdq spec). Each one opens a region that runs to the next
annotation: `[0]` is the score, `[+2]` is relative, and `{example}` or
`{public}` mark the region as visible.

- Cases before the first annotation belong to no region.
- A region without a case is an error.
- In the browser pretest, only cases of `{public}` and `{example}` regions
  run, so the student never receives a private case name (it contains the
  expected value). A block without a public case is not a pretest.
- The worker runs every case and gives the score of each region.

## Errors

- Writing a question with an invalid examples block, an unresolved `module`
  header, or an `Examples<i>` that clashes with the answer module or another
  source is refused, with the source index and the line. The same checks mark
  old documents in the question problems.
- Only syntax is checked at write time. A type error in an example is found at
  grading and is a question error, never the student's.
- Without a code runner in the instance, the pretest button is disabled and
  the page says that code execution is off.
