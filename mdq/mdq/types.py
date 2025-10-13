from __future__ import annotations
from dataclasses import dataclass
from enum import Enum, auto
from fractions import Fraction
from typing import Literal
import re

ITEM_MARK_REGEX = re.compile(r"""
    \s*
    \[(?:
        [\ \t]*
        (?P<tf>[tTfF])
        |(?P<check>[xX])
        |(?:(?P<pc>[0-9]+(?:\.[0-9]+)?)%)
        |(?P<other>[^\]]*)
        [\ \t]*
    )\]
    (?!\()
""", re.VERBOSE)

type Percent = float | int | Fraction


class NOT_GIVEN_TYPE(Enum):
    NOT_GIVEN = auto()


NOT_GIVEN = NOT_GIVEN_TYPE.NOT_GIVEN


@dataclass
class ItemMark:
    kind: Literal["true-false", "select", "none"]
    value: bool | Percent | None = None

    @classmethod
    def parse(cls, src: str) -> ItemMark:
        m = ITEM_MARK_REGEX.match(src)
        if not m:
            return ItemMark("none")

        kind = m.lastgroup or "other"
        data = m.groupdict()[kind]
        match kind:
            case "tf":
                return ItemMark("true-false", data.lower() == "t")
            case "check":
                return ItemMark("select", True)
            case "pc":
                return ItemMark("select", float(data))
            case "other" if not data:
                return ItemMark("select", False)
            case _:
                raise NotImplementedError(m.groupdict())

def parse_item_mark_content(src: str):
    ...