"""
Test helper: the envelope a REST list route answers with.
"""

from __future__ import annotations

from collections.abc import Iterable

__all__ = ["page"]


def page(items: Iterable[object], next: str | None = None) -> dict[str, object]:
    """
    A list route's response body: `items` as one page, `next` the following cursor.
    """
    return {"items": list(items), "next": next}
