"""
The REST calls of a pull worker (`/api/grading-jobs/`), authenticated with
the instructor's `BOT` key.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import httpx

__all__ = ["ApiError", "Conflict", "WorkerClient"]


class ApiError(RuntimeError):
    """
    The server refused a request.
    """

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"{status}: {message}")
        self.status = status


class Conflict(ApiError):
    """
    The job moved on without this worker: the lease was lost, the student
    replaced the submission, or an instructor graded it.
    """


class WorkerClient:
    """
    Claims grading jobs and sends their results.
    """

    def __init__(
        self, server: str, key: str, *, http: httpx.Client | None = None, timeout: float = 30
    ) -> None:
        self.base = server.rstrip("/") + "/api/grading-jobs"
        self.http = http or httpx.Client(timeout=timeout)
        self.headers = {"Authorization": f"Bearer {key}"}

    def claim(
        self,
        workers: Sequence[str],
        *,
        limit: int,
        lease: float,
        discipline: str | None = None,
        course: str | None = None,
        exam: str | None = None,
        questions: Sequence[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Take up to `limit` queued jobs of the given workers, leased for
        `lease` seconds.
        """
        body: dict[str, Any] = {"workers": list(workers), "limit": limit, "lease": lease}
        optional = {"discipline": discipline, "course": course, "exam": exam}
        body |= {k: v for k, v in optional.items() if v is not None}
        if questions is not None:
            body["questions"] = list(questions)
        return self._post("claim", body)["jobs"]

    def renew(self, submission: str, lease: float) -> None:
        """
        Extend the lease of a job this worker holds.
        """
        self._post(f"{submission}/renew", {"lease": lease})

    def fail(self, submission: str, error: str, retry: bool) -> None:
        """
        Give a job back: `retry` counts an infrastructure failure, without it
        the job returns to the queue as it was.
        """
        self._post(f"{submission}/fail", {"error": error, "retry": retry})

    def result(self, submission: str, report: dict[str, Any]) -> dict[str, Any]:
        """
        Send the runner report of a job, which closes it.
        """
        return self._post(f"{submission}/result", report)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.http.post(f"{self.base}/{path}", json=body, headers=self.headers)
        if response.status_code >= 400:
            error = Conflict if response.status_code == 409 else ApiError
            raise error(response.status_code, _message(response))
        return response.json() if response.content else {}


def _message(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:500] or response.reason_phrase
    if isinstance(data, dict):
        for key in ("message", "error", "detail"):
            if isinstance(data.get(key), str):
                return data[key]
    return str(data)[:500]
