"""
Elm tests written as examples, one `expr ==> value` or `expr ~= value` per line.

A fenced test source of an Elm question that has no `module` header is an
examples block, turned into an elm-test module. The format has a twin in
TypeScript (`src/services/elm-examples.ts` of codehood), and both run the
table `tests/resources/elm-examples-cases.json`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from mdq._parser import scan_annotations

__all__ = [
    "Example",
    "ExampleError",
    "answer_module",
    "example_cases",
    "examples_module",
    "locate_example",
    "module_name",
]

#: Prefix of the name of the generated module, followed by the source index.
MODULE_PREFIX = "Examples"

#: The operators of a case, with the matcher each one generates.
OPERATORS = {
    "==>": "Expect.equal",
    "~=": "Expect.within (Expect.AbsoluteOrRelative 1.0e-9 1.0e-6)",
}

type ErrorKind = Literal[
    "invalid-line",
    "invalid-annotation",
    "late-import",
    "duplicate-name",
    "no-cases",
    "empty-region",
]

#: The `ANNOTATION_START` terminal of the MDQ spec (`docs/question-types/code.md`,
#: "Annotations"), anchored at the start of a line. mdq-py does not expose it.
_ANNOTATION_START = re.compile(r"[ \t!-/:-@\[-`{-~]*mdq:")


class ExampleError(ValueError):
    """
    An examples block breaks the format. It is a mistake of the question
    author, never of a student.
    """

    def __init__(self, message: str, line: int | None, kind: ErrorKind) -> None:
        super().__init__(message)
        #: The line of the block, from 1, or None when the error has no line.
        self.line = line
        self.kind = kind


@dataclass(frozen=True)
class Example:
    """
    One case of an examples block.
    """

    #: The line of the source, from 1.
    line: int
    operator: str
    expr: str
    value: str
    comment: str = ""
    #: Whether the case is in a `{public}` or `{example}` region.
    public: bool = False

    @property
    def name(self) -> str:
        """
        The name of the test the student sees: `expr ==> value (comment)`.
        """
        base = f"{self.expr} {self.operator} {self.value}"
        return f"{base} ({self.comment})" if self.comment else base


def module_name(index: int) -> str:
    """
    The name of the module generated for the test source at `index`.
    """
    return f"{MODULE_PREFIX}{index}"


def answer_module(file: str) -> str:
    """
    The module of an Elm answer file: `Foo/Bar.elm` is `Foo.Bar`.
    """
    return file.removesuffix(".elm").replace("/", ".")


def example_cases(text: str) -> list[Example]:
    """
    The cases of an examples block, in source order.

    Raises:
        ExampleError: the block is invalid.
    """
    return _parse(text)[1]


def examples_module(
    text: str, index: int, answer_file: str, public_only: bool = False
) -> str | None:
    """
    The elm-test module of an examples block, importing the answer module, or
    None when `public_only` is set and no case is public.

    Raises:
        ExampleError: the block is invalid.
    """
    imports, cases = _parse(text)
    chosen = [c for c in cases if c.public] if public_only else cases
    if not chosen:
        return None
    entries = [
        f"        {'[' if i == 0 else ','} Test.test {_string(c.name)} "
        f"(\\_ -> {OPERATORS[c.operator]} ({c.value}) ({c.expr}))"
        for i, c in enumerate(chosen)
    ]
    lines = [
        f"module {module_name(index)} exposing (tests)",
        "",
        "import Expect",
        "import Test",
        f"import {answer_module(answer_file)} exposing (..)",
        *imports,
        "",
        "",
        "tests : Test.Test",
        "tests =",
        "    Test.concat",
        *entries,
        "        ]",
        "",
    ]
    return "\n".join(lines)


def locate_example(text: str, name: str) -> int | None:
    """
    The line of the case of a block whose test is called `name`.
    """
    try:
        return next((e.line for e in example_cases(text) if e.name == name), None)
    except ExampleError:
        return None


def _string(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _parse(text: str) -> tuple[list[str], list[Example]]:
    """
    The `import` lines and the cases of a block.
    """
    scan = scan_annotations(text)
    if scan.problems:
        problem = scan.problems[0]
        raise ExampleError(
            f"line {problem.line}: {problem.message}", problem.line, "invalid-annotation"
        )
    imports: list[str] = []
    cases: list[Example] = []
    names: set[str] = set()
    for number, line in enumerate(scan.lines, start=1):
        if _ANNOTATION_START.match(line):
            continue
        if not line.strip(" \t") or line.lstrip(" \t").startswith("--"):
            continue
        if re.match(r"import[ \t]", line):
            if cases:
                raise ExampleError(
                    f"line {number}: import after the first case", number, "late-import"
                )
            imports.append(line.rstrip(" \t"))
            continue
        region = next((it for it in reversed(scan.items) if it.line <= number), None)
        case = _parse_case(line, number, region is not None and region.public)
        if case.name in names:
            raise ExampleError(
                f"line {number}: duplicate case {case.name!r}", number, "duplicate-name"
            )
        names.add(case.name)
        cases.append(case)
    for item in scan.items:
        first = item.line + item.annotation_lines
        if not any(first <= c.line <= item.end for c in cases):
            raise _empty_region(item.line)
    if not cases:
        raise ExampleError("the block has no case", None, "no-cases")
    return imports, cases


def _empty_region(line: int) -> ExampleError:
    return ExampleError(f"line {line}: the annotated region has no case", line, "empty-region")


def _parse_case(line: str, number: int, public: bool) -> Example:
    comments = _outside_literals(line, "--")
    code = line[: comments[0]] if comments else line
    comment = line[comments[0] + 2 :].strip(" \t") if comments else ""
    found = [(op, at) for op in OPERATORS for at in _outside_literals(code, op)]
    if len(found) != 1:
        raise _invalid(number, line)
    operator, at = found[0]
    expr = code[:at].strip(" \t")
    value = code[at + len(operator) :].strip(" \t")
    if not expr or not value:
        raise _invalid(number, line)
    return Example(number, operator, expr, value, comment, public)


def _invalid(number: int, line: str) -> ExampleError:
    hint = " (triple-quoted strings are not supported)" if '"""' in line else ""
    return ExampleError(
        f"line {number}: expected `expr ==> value` or `expr ~= value`{hint}", number, "invalid-line"
    )


def _outside_literals(text: str, token: str) -> list[int]:
    """
    The positions of `token` in `text` outside string and character literals.
    An unterminated literal runs to the end of the text.
    """
    found: list[int] = []
    i = 0
    while i < len(text):
        c = text[i]
        if c == '"' or (
            c == "'" and not (i > 0 and (text[i - 1].isalnum() or text[i - 1] in "_'"))
        ):
            i = _literal_end(text, i)
        elif text.startswith(token, i):
            found.append(i)
            i += len(token)
        else:
            i += 1
    return found


def _literal_end(text: str, start: int) -> int:
    quote = text[start]
    i = start + 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
        elif text[i] == quote:
            return i + 1
        else:
            i += 1
    return len(text)
