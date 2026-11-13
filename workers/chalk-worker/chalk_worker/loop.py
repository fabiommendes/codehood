"""
The claim loop of the worker.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Protocol

import httpx
from mdq.models import CodeQuestion, RunnerReport

from .client import ApiError, Conflict
from .grading import PrepareFailed, ReferenceError, question_hash
from .job import Job, JobError, parse_job

__all__ = ["Filters", "Worker"]

#: Longest wait between claims on an empty queue, in seconds.
MAX_POLL = 60.0

#: Longest error message sent to the server, in characters.
MAX_ERROR = 2000


class Server(Protocol):
    def claim(self, workers: Sequence[str], *, limit: int, lease: float, **filters) -> list: ...
    def renew(self, submission: str, lease: float) -> None: ...
    def fail(self, submission: str, error: str, retry: bool) -> None: ...
    def result(self, submission: str, report: dict[str, Any]) -> dict[str, Any]: ...


class Grader(Protocol):
    def prepare(self) -> None: ...
    def grade(self, answer: str) -> RunnerReport: ...


@dataclass(frozen=True)
class Filters:
    """
    Which jobs to claim, besides the worker ids.
    """

    discipline: str | None = None
    course: str | None = None
    exam: str | None = None

    def given(self) -> dict[str, str]:
        return {k: v for k, v in asdict(self).items() if v is not None}


class Worker:
    """
    Claims jobs, grades them and sends the reports until stopped.
    """

    def __init__(
        self,
        server: Server,
        make_grader: Callable[[CodeQuestion], Grader],
        *,
        workers: Sequence[str],
        batch: int = 4,
        poll: float = 10,
        lease: float = 120,
        filters: Filters = Filters(),
        log: Callable[[str], None] = print,
    ) -> None:
        self.server = server
        self.make_grader = make_grader
        self.workers = list(workers)
        self.batch = batch
        self.poll = poll
        self.lease = lease
        self.filters = filters
        self.log = log
        self._stop = threading.Event()
        #: Prepared graders, or the reason the question cannot be graded, by hash.
        self._graders: dict[str, Grader | ReferenceError] = {}

    def stop(self) -> None:
        """
        Finish the job in progress, give the others back and leave `run`.
        """
        self._stop.set()

    def run(self, once: bool = False) -> int:
        """
        Process jobs until stopped, or, with `once`, until a claim comes back
        empty. Returns the number of jobs processed.
        """
        done = 0
        wait = self.poll
        while not self._stop.is_set():
            try:
                jobs = self.server.claim(
                    self.workers, limit=self.batch, lease=self.lease, **self.filters.given()
                )
            except (ApiError, httpx.HTTPError) as e:
                self.log(f"claim failed: {e}")
                if once:
                    break
                self._stop.wait(wait)
                wait = min(wait * 2, MAX_POLL)
                continue
            if not jobs:
                if once:
                    break
                self._stop.wait(wait)
                wait = min(wait * 2, MAX_POLL)
                continue
            wait = self.poll
            for index, data in enumerate(jobs):
                if self._stop.is_set():
                    self._give_back(jobs[index:])
                    break
                try:
                    self._process(data)
                except PrepareFailed as e:
                    self.log(f"{e}")
                    self._give_back(jobs[index:], f"worker cannot grade now: {e}")
                    break
                done += 1
            else:
                continue
            if once or self._stop.is_set():
                break
            self.log(f"waiting {wait:.0f}s before claiming again")
            self._stop.wait(wait)
            wait = min(wait * 2, MAX_POLL)
        return done

    def _process(self, data: dict[str, Any]) -> None:
        submission = str(data.get("submission", "?"))
        started = time.monotonic()
        try:
            job = parse_job(data)
        except JobError as e:
            self._fail(submission, f"invalid job: {e}")
            return
        grader = self._grader(job.question)
        if isinstance(grader, ReferenceError):
            self._fail(submission, f"question {job.question.id}: {grader}")
            return
        with _Renewer(self.server, submission, self.lease, self.log):
            try:
                report = grader.grade(job.answer)
            except Exception as e:  # the sandbox, the profile or the disk
                self._fail(submission, f"{type(e).__name__}: {e}")
                return
        self._send(job, report, time.monotonic() - started)

    def _grader(self, question: CodeQuestion) -> Grader | ReferenceError:
        """
        The prepared grader of a question, or why it cannot be graded.

        Raises:
            PrepareFailed: the profile could not be prepared; nothing is cached.
        """
        key = question_hash(question)
        if key not in self._graders:
            try:
                grader = self.make_grader(question)
                grader.prepare()
                self._graders[key] = grader
            except ReferenceError as e:
                self.log(f"question {question.id}: {e}")
                self._graders[key] = e
        return self._graders[key]

    def _send(self, job: Job, report: RunnerReport, seconds: float) -> None:
        body = report.model_dump(by_alias=True, exclude_none=True, mode="json")
        try:
            answer = self.server.result(job.submission, body)
        except Conflict as e:
            self.log(f"{job.student} {job.question.id} skipped: {e}")
            return
        except (ApiError, httpx.HTTPError) as e:
            self.log(f"{job.student} {job.question.id} result refused: {e}")
            self._fail(job.submission, f"result refused: {e}")
            return
        outcome = answer.get("status") or report.status
        score = answer.get("score")
        self.log(
            f"{job.student} {job.question.id} {outcome}"
            + (f" {score}" if score is not None else "")
            + f" {seconds:.1f}s"
        )

    def _fail(self, submission: str, error: str, retry: bool = True) -> None:
        self.log(f"{submission} failed: {error.splitlines()[0] if error else ''}")
        try:
            self.server.fail(submission, error[:MAX_ERROR], retry)
        except (ApiError, httpx.HTTPError) as e:
            self.log(f"{submission}: could not report the failure: {e}")

    def _give_back(self, jobs: Sequence[dict[str, Any]], reason: str = "worker stopping") -> None:
        for data in jobs:
            submission = str(data.get("submission", "?"))
            try:
                self.server.fail(submission, reason[:MAX_ERROR], False)
            except (ApiError, httpx.HTTPError) as e:
                self.log(f"{submission}: could not give back: {e}")


class _Renewer:
    """
    Renews the lease of a job at half its length while the job is graded.
    """

    def __init__(self, server: Server, submission: str, lease: float, log) -> None:
        self.server = server
        self.submission = submission
        self.lease = lease
        self.log = log
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def __enter__(self) -> _Renewer:
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._done.set()
        self._thread.join()

    def _loop(self) -> None:
        while not self._done.wait(self.lease / 2):
            try:
                self.server.renew(self.submission, self.lease)
            except Conflict:
                self.log(f"{self.submission}: lease lost")
                return
            except (ApiError, httpx.HTTPError) as e:
                self.log(f"{self.submission}: renew failed: {e}")
