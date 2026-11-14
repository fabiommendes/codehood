"""
Read a whole listing from a REST list route, page by page.

Every `GET` list route answers an envelope, `{"items": [...], "next": ...}`:
`items` is one page and `next` is the cursor of the following one, sent back
as `after`, or `null` on the last page. A route that does not paginate
answers everything at once with `next: null`, so following `next` is correct
on every list route, paginated or not.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Protocol, cast

__all__ = ["Page", "read_all"]


class Page[T](Protocol):
    """
    One page of a list route: the generated `List*Response` models.
    """

    @property
    def items(self) -> Sequence[T]: ...

    @property
    def next(self) -> str | None: ...


def read_all[**P, T](
    fetch: Callable[P, Page[T]], *args: P.args, **kwargs: P.kwargs
) -> list[T]:
    """
    Call a list function with `args` and `kwargs`, following `next` until the last page.

    The first page is fetched without `after`; each following one passes the
    previous page's `next` as `after`. The page size is left to the server.

    Example:
        >>> read_all(generated.list_course, edition="2026-1")  # doctest: +SKIP

    Raises:
        TypeError: When the server pages a route whose `fetch` takes no
            `after`, i.e. the generated client is older than the server.
    """
    page = fetch(*args, **kwargs)
    items = list(page.items)
    paged = cast(Callable[..., Page[T]], fetch)
    while page.next is not None:
        page = paged(*args, **kwargs, after=page.next)
        items.extend(page.items)
    return items
