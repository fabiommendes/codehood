"""
Test helper: the envelope a REST list route answers with.
"""

from __future__ import annotations

from collections.abc import Iterable

__all__ = ["page"]


def page(
    items: Iterable[object], next: str | None = None, prev: str | None = None
) -> dict[str, object]:
    """
    A list route's response body: `items` as one page, `next` and `prev` the
    cursors of the pages around it.
    """
    return {"items": list(items), "next": next, "prev": prev}
