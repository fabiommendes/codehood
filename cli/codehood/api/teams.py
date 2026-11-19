"""
The teams of an assignment, read whole.

`generated.team_list` takes no `after`, so `read_all` cannot follow a cursor
through it; this follows `next` the same way over the raw route, and reads
every page with the generated model.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from . import generated
from .base import auth_headers

__all__ = ["list_teams"]


def list_teams(
    *, discipline: str, course: str, slug: str, client: httpx.Client
) -> list[generated.TeamListed]:
    """
    Every team of the assignment `slug`, deliveries included, page by page.

    Raises:
        httpx.HTTPStatusError: The server refuses a page, a 404 when the
            assignment does not exist.
    """
    url = f"/api/course/{discipline}/{course}/assignment/{quote(slug, safe='')}/team"
    teams: list[generated.TeamListed] = []
    after: str | None = None
    while True:
        response = client.get(
            url,
            params={"after": after} if after is not None else None,
            headers=auth_headers(client),
        )
        response.raise_for_status()
        page = generated.TeamListResponse.model_validate(response.json())
        teams.extend(page.items)
        if page.next is None:
            return teams
        after = page.next
