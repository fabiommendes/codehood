"""
Elm tests written as examples, one `expr ==> value` per line.

A test source of an Elm question that has no `module` header and holds only
examples is turned into an elm-test module. Each example becomes a test named
after its line, so the name reaches the student as feedback.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = [
    "Example",
    "ExampleError",
    "examples_module",
    "locate_example",
    "module_name",
    "parse_examples",
]

#: Prefix of the name of the generated module, followed by the source index.
MODULE_PREFIX = "Examples"

ARROW = "==>"


class ExampleError(ValueError):
    """
    A line of an examples block is not `expr ==> value`. It is a mistake of
    the question author, never of a student.
    """


@dataclass(frozen=True)
class Example:
    """
    One `expr ==> value` line.
    """

    #: The line of the source, from 1.
    line: int
    expr: str
    value: str
    comment: str = ""

    @property
    def name(self) -> str:
        """
        The name of the test: the line itself, with the comment in parentheses.
        """
        base = f"{self.expr} {ARROW} {self.value}"
        return f"{base} ({self.comment})" if self.comment else base


def module_name(index: int) -> str:
    """
    The name of the module generated for the test source at `index`.
    """
    return f"{MODULE_PREFIX}{index}"


def parse_examples(text: str) -> list[Example]:
    """
    The examples of a block. Blank lines and lines with only a `--` comment
    are skipped.

    Raises:
        ExampleError: a line is not an example, or there is none.
    """
    found: list[Example] = []
    for number, line in enumerate(text.splitlines(), start=1):
        body, comment = _split_comment(line, number)
        if not body.strip():
            continue
        parts = _split_arrow(body, number)
        found.append(Example(number, parts[0], parts[1], comment))
    if not found:
        raise ExampleError("no `expr ==> value` example")
    return found


def examples_module(text: str, index: int, answer_module: str) -> str:
    """
    The elm-test module of an examples block, importing the answer module.

    Raises:
        ExampleError: see `parse_examples`.
    """
    tests = "\n        , ".join(
        f"test {_string(e.name)} <|\n            \\_ -> Expect.equal ({e.value}) ({e.expr})"
        for e in parse_examples(text)
    )
    return (
        f"module {module_name(index)} exposing (suite)\n\n"
        "import Expect\n"
        f"import {answer_module} exposing (..)\n"
        "import Test exposing (Test, describe, test)\n\n\n"
        "suite : Test\n"
        "suite =\n"
        '    describe "examples"\n'
        f"        [ {tests}\n        ]\n"
    )


def locate_example(text: str, name: str) -> int | None:
    """
    The line of the example of a block whose test is called `name`.
    """
    try:
        return next((e.line for e in parse_examples(text) if e.name == name), None)
    except ExampleError:
        return None


def _string(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _scan(line: str, number: int):
    """
    Yield (position, char) of the characters of `line` outside string and
    character literals.
    """
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if line.startswith('"""', i):
            end = line.find('"""', i + 3)
            if end < 0:
                raise ExampleError(f"line {number}: unterminated multi-line string")
            i = end + 3
        elif c == '"':
            i += 1
            while i < n and line[i] != '"':
                i += 2 if line[i] == "\\" else 1
            if i >= n:
                raise ExampleError(f"line {number}: unterminated string")
            i += 1
        elif c == "'" and not (i > 0 and (line[i - 1].isalnum() or line[i - 1] in "_'")):
            i += 1
            while i < n and line[i] != "'":
                i += 2 if line[i] == "\\" else 1
            if i >= n:
                raise ExampleError(f"line {number}: unterminated character literal")
            i += 1
        else:
            yield i, c
            i += 1


def _split_comment(line: str, number: int) -> tuple[str, str]:
    for i, _ in _scan(line, number):
        if line.startswith("--", i):
            return line[:i], line[i + 2 :].strip()
    return line, ""


def _split_arrow(body: str, number: int) -> tuple[str, str]:
    at = [i for i, _ in _scan(body, number) if body.startswith(ARROW, i)]
    if len(at) != 1:
        raise ExampleError(f"line {number}: expected `expr {ARROW} value`, found {body.strip()!r}")
    expr, value = body[: at[0]].strip(), body[at[0] + len(ARROW) :].strip()
    if not expr or not value:
        raise ExampleError(f"line {number}: `{ARROW}` needs an expression on each side")
    return expr, value
