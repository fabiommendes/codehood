"""
Find where a test case is defined in the test sources of a question.

A runner report names a case by the index of its test source and the line
of its definition, which decide the rubric item that owns it. The test
tools report names, so each format needs a locator.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

__all__ = ["elm_module", "locate_elm"]

_MODULE = re.compile(r"^(?:port\s+|effect\s+)?module\s+([A-Z][\w.]*)", re.MULTILINE)
_STRING = r'"((?:[^"\\\n]|\\.)*)"'
_CASE = re.compile(r"\b(?:test|todo|fuzz\d?|fuzzWith)\b[^\"\n]*?" + _STRING)
_DESCRIBE = re.compile(r"\bdescribe\s+" + _STRING)
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r"}


def elm_module(text: str) -> str | None:
    """
    The name of the module the Elm source declares, or None without a header.
    """
    match = _MODULE.search(text)
    return match[1] if match else None


def locate_elm(sources: Sequence[str], classname: str, name: str) -> tuple[int, int] | None:
    """
    The (source index, line) of an elm-test case from its JUnit `classname`
    (`<Module> <describe>...`) and `name`, or None when it is not found.

    Two cases with the same name are told apart by the innermost `describe`
    before each, which must end the classname.
    """
    module, _, path = classname.partition(" ")
    for index, text in enumerate(sources):
        if elm_module(text) != module:
            continue
        lines = text.splitlines()
        found: list[tuple[int, str | None]] = []
        describe: str | None = None
        for number, line in enumerate(lines, start=1):
            for match in _DESCRIBE.finditer(line):
                describe = _unescape(match[1])
            for match in _CASE.finditer(line):
                if _unescape(match[1]) == name:
                    found.append((number, describe))
        if not found:
            return None
        if len(found) > 1:
            for number, inner in found:
                if inner is not None and (path == inner or path.endswith(f" {inner}")):
                    return index, number
        return index, found[0][0]
    return None


def _unescape(text: str) -> str:
    return re.sub(r"\\(.)", lambda m: _ESCAPES.get(m[1], m[1]), text)
