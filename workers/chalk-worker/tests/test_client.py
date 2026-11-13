"""
The REST calls of the worker, against the contract of R19.
"""

import json

import httpx
import pytest

from chalk_worker.client import ApiError, Conflict, WorkerClient


def make(handler) -> tuple[WorkerClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    http = httpx.Client(transport=httpx.MockTransport(record))
    return WorkerClient("http://host:4321/", "k3y", http=http), seen


def test_claim_sends_the_filters_and_the_key() -> None:
    client, seen = make(lambda r: httpx.Response(200, json={"jobs": [{"submission": "a"}]}))
    jobs = client.claim(["elm-test"], limit=2, lease=90, exam="teste-1", questions=["q1"])
    assert jobs == [{"submission": "a"}]
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == "http://host:4321/api/grading-jobs/claim"
    assert request.headers["authorization"] == "Bearer k3y"
    assert json.loads(request.content) == {
        "workers": ["elm-test"],
        "limit": 2,
        "lease": 90,
        "exam": "teste-1",
        "questions": ["q1"],
    }


def test_renew_fail_and_result_address_the_submission() -> None:
    client, seen = make(lambda r: httpx.Response(200, json={"state": "DONE"}))
    client.renew("sub1", lease=120)
    client.fail("sub1", "boom", retry=False)
    assert client.result("sub1", {"status": "completed", "cases": []}) == {"state": "DONE"}
    assert [r.url.path for r in seen] == [
        "/api/grading-jobs/sub1/renew",
        "/api/grading-jobs/sub1/fail",
        "/api/grading-jobs/sub1/result",
    ]
    assert json.loads(seen[1].content) == {"error": "boom", "retry": False}
    assert json.loads(seen[2].content) == {"status": "completed", "cases": []}


def test_conflict_is_its_own_error() -> None:
    client, _ = make(lambda r: httpx.Response(409, json={"message": "lease lost"}))
    with pytest.raises(Conflict, match="lease lost"):
        client.renew("sub1", lease=120)


def test_other_errors_carry_status_and_message() -> None:
    client, _ = make(lambda r: httpx.Response(403, json={"message": "BOT key required"}))
    with pytest.raises(ApiError) as info:
        client.claim(["elm-test"], limit=1, lease=120)
    assert info.value.status == 403
    assert "BOT key required" in str(info.value)
