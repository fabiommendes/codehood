"""
Tests for `codehood.api.pages.read_all`, against a generated list function
and a fake transport that pages its listing.
"""

from __future__ import annotations

import httpx
import pytest
from pages import page

from codehood.api import generated
from codehood.api.base import save_token
from codehood.api.pages import read_all

BASE_URL = "http://localhost:4321"


@pytest.fixture(autouse=True)
def logged_in() -> None:
    save_token(BASE_URL, "test-token")


def users(*names: str) -> list[dict[str, str]]:
    return [{"username": name, "name": name.title()} for name in names]


def client_for(pages: dict[str | None, dict], seen: list[httpx.QueryParams]):
    """
    A client whose `GET /api/user` answers `pages[after]`.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/user"
        seen.append(request.url.params)
        return httpx.Response(200, json=pages[request.url.params.get("after")])

    return httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(handler))


def test_a_single_page_takes_one_request():
    seen: list[httpx.QueryParams] = []
    client = client_for({None: page(users("ada", "bob"))}, seen)

    result = read_all(generated.list_user, client=client)

    assert [user.username for user in result] == ["ada", "bob"]
    assert len(seen) == 1
    assert "after" not in seen[0]


def test_several_pages_follow_the_cursor_in_order():
    seen: list[httpx.QueryParams] = []
    client = client_for(
        {
            None: page(users("ada", "bob"), next="c1"),
            "c1": page(users("cid"), next="c2"),
            "c2": page(users("dan")),
        },
        seen,
    )

    result = read_all(generated.list_user, client=client)

    assert [user.username for user in result] == ["ada", "bob", "cid", "dan"]
    assert [params.get("after") for params in seen] == [None, "c1", "c2"]


def test_filters_are_sent_on_every_page():
    seen: list[httpx.QueryParams] = []
    client = client_for(
        {None: page(users("ada"), next="c1"), "c1": page(users("bob"))}, seen
    )

    read_all(generated.list_user, usernames=["ada", "bob"], client=client)

    assert [params.get_list("usernames") for params in seen] == [["ada", "bob"]] * 2
    assert all("limit" not in params for params in seen)


def test_an_empty_listing_is_an_empty_list():
    seen: list[httpx.QueryParams] = []
    client = client_for({None: page([])}, seen)

    assert read_all(generated.list_user, client=client) == []
    assert len(seen) == 1


def test_a_function_without_after_cannot_follow_a_cursor():
    """
    A stale generated function for a route the server now pages fails loudly
    rather than returning the first page alone.
    """

    def stale_list() -> generated.ListUserResponse:
        return generated.ListUserResponse(items=[], next="c1", prev=None)

    with pytest.raises(TypeError, match="after"):
        read_all(stale_list)
