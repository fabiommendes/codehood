"""
The claim loop of the worker.

The loop claims as many jobs as it has free slots, so no claimed job waits
for a slot while its lease runs out, and grades each job in a thread of its
own. Grading runs the profile's tools in subprocesses, so threads are enough
to use every core. Each question is prepared once, by the first job that
needs it; the other jobs of the question wait for it.

With a memory budget per job, the loop also claims only the jobs the
available memory of the machine holds, counting each job in progress at its
whole budget, so the slots in use shrink when memory runs short.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Any, Protocol

import httpx
from mdq.models import CodeQuestion, RunnerReport

from .client import ApiError, Conflict
from .grading import PrepareFailed, ReferenceError, question_hash
from .job import Job, JobError, parse_job
from .status import Status

__all__ = ["Filters", "Worker", "available_memory"]

#: Longest wait between claims on an empty queue, in seconds.
MAX_POLL = 60.0

#: Longest error message sent to the server, in characters.
MAX_ERROR = 2000

MiB = 1024 * 1024

#: How a job ended: a server status or `failed`, `skipped`, `returned`, and the score.
type Outcome = tuple[str, str | None]


def available_memory() -> int | None:
    """
    The memory the machine can give without swapping (`MemAvailable`), in
    bytes, or None when it is unknown.
    """
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


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
    Claims jobs, grades up to `jobs` of them at once and sends the reports
    until stopped.

    `make_grader` and the graders it makes are called from the grading
    threads; a grader may grade several answers at once once prepared.

    `memory` is what one job may take, in bytes; with it, a job starts only
    while the available memory, less `reserve`, holds it on top of the
    budgets of the jobs in progress.
    """

    def __init__(
        self,
        server: Server,
        make_grader: Callable[[CodeQuestion], Grader],
        *,
        workers: Sequence[str],
        jobs: int = 1,
        batch: int | None = None,
        poll: float = 10,
        lease: float = 120,
        filters: Filters = Filters(),
        log: Callable[[str], None] = print,
        status: Status | None = None,
        memory: int | None = None,
        reserve: int = 512 * MiB,
        available: Callable[[], int | None] = available_memory,
    ) -> None:
        self.server = server
        self.make_grader = make_grader
        self.workers = list(workers)
        self.jobs = max(1, jobs)
        #: Most jobs asked for in one claim.
        self.batch = max(1, batch or self.jobs)
        self.poll = poll
        self.lease = lease
        self.filters = filters
        self.log = log
        self.status = status or Status(self.jobs)
        self.memory = memory
        self.reserve = reserve
        self.available = available
        self._stop = threading.Event()
        self._resume = threading.Event()
        self._resume.set()
        #: Set when a slot frees up, to wake the loop waiting for one.
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._busy = 0
        self._done = 0
        #: Prepared graders, or the reason the question cannot be graded, by hash.
        self._graders: dict[str, Grader | ReferenceError] = {}
        self._question_locks: dict[str, threading.Lock] = {}
        #: Questions whose profile failed to prepare since the last pause.
        self._unprepared: dict[str, PrepareFailed] = {}
        self._backoff = False

    def stop(self) -> None:
        """
        Stop claiming, finish the jobs in progress and leave `run`.
        """
        self._stop.set()
        self._wake.set()
        self._resume.set()

    def pause(self) -> None:
        """
        Stop claiming until `resume`; the jobs in progress go on.
        """
        self._resume.clear()
        self.status.set_paused(True)

    def resume(self) -> None:
        self.status.set_paused(False)
        self._resume.set()

    @property
    def paused(self) -> bool:
        return not self._resume.is_set()

    def run(self, once: bool = False) -> int:
        """
        Process jobs until stopped, or, with `once`, until a claim comes back
        empty. Returns the number of jobs processed, not counting the ones
        given back.
        """
        self._done = 0
        with ThreadPoolExecutor(self.jobs, thread_name_prefix="grade") as pool:
            try:
                self._claim_loop(pool, once)
            finally:
                if self._busy:
                    self.status.set_state(f"finishing {self._busy} jobs")
        self.status.set_state("stopped")
        return self._done

    def _claim_loop(self, pool: ThreadPoolExecutor, once: bool) -> None:
        wait = self.poll
        while not self._stop.is_set():
            if not self._resume.is_set():
                self.status.set_state("paused")
                self._resume.wait()
                continue
            if self._take_backoff():
                if once:
                    break
                self._say(f"waiting {wait:.0f}s before claiming again")
                self._idle(f"cannot grade now; next claim in {wait:.0f}s", wait)
                wait = min(wait * 2, MAX_POLL)
                with self._lock:
                    self._unprepared.clear()
                continue
            self._wake.clear()
            free = self.jobs - self._busy
            if free <= 0:
                self.status.set_state(f"{self._busy} jobs running")
                self._wake.wait()
                continue
            fit, note = self._fit_in_memory()
            if fit <= 0:
                if once and not self._busy:
                    self._say(f"not enough memory to grade: {note}")
                    break
                self.status.set_state(f"low memory: {note}")
                # A job that ends, or memory freed elsewhere, may make room.
                self._wake.wait(self.poll)
                continue
            free = min(free, fit)
            self.status.set_state("claiming")
            try:
                jobs = self.server.claim(
                    self.workers,
                    limit=min(self.batch, free),
                    lease=self.lease,
                    **self.filters.given(),
                )
            except (ApiError, httpx.HTTPError) as e:
                self._say(f"claim failed: {e}")
                if once:
                    break
                self._idle(f"claim failed; next claim in {wait:.0f}s", wait)
                wait = min(wait * 2, MAX_POLL)
                continue
            if not jobs:
                if once:
                    break
                self._idle(f"queue empty; next claim in {wait:.0f}s", wait)
                wait = min(wait * 2, MAX_POLL)
                continue
            wait = self.poll
            for data in jobs:
                self._start(pool, data)

    def _fit_in_memory(self) -> tuple[int, str]:
        """
        How many more jobs the memory holds, and why, counting each job in
        progress at its whole budget.
        """
        if not self.memory:
            return self.jobs, ""
        available = self.available()
        if available is None:
            return self.jobs, ""
        spare = available - self.reserve - self._busy * self.memory
        note = (
            f"{available / MiB:.0f} MiB available, {self.memory / MiB:.0f} MiB per job, "
            f"{self.reserve / MiB:.0f} MiB kept"
        )
        return int(spare // self.memory), note

    def _idle(self, state: str, seconds: float) -> None:
        self.status.set_state(state)
        self._stop.wait(seconds)

    def _take_backoff(self) -> bool:
        with self._lock:
            backoff, self._backoff = self._backoff, False
            return backoff

    def _start(self, pool: ThreadPoolExecutor, data: dict[str, Any]) -> None:
        with self._lock:
            self._busy += 1
        slot = self.status.take_slot(str(data.get("submission", "?")))
        pool.submit(self._job, data, slot)

    def _job(self, data: dict[str, Any], slot: int) -> None:
        outcome: Outcome = ("failed", None)
        try:
            outcome = self._process(data, slot)
        except Exception as e:  # a bug of the worker: keep the other slots going
            submission = str(data.get("submission", "?"))
            self._fail(submission, f"{type(e).__name__}: {e}")
        finally:
            self.status.finish(slot, *outcome)
            with self._lock:
                self._busy -= 1
                if outcome[0] != "returned":
                    self._done += 1
            self._wake.set()

    def _process(self, data: dict[str, Any], slot: int) -> Outcome:
        submission = str(data.get("submission", "?"))
        started = time.monotonic()
        try:
            job = parse_job(data)
        except JobError as e:
            self._fail(submission, f"invalid job: {e}")
            return ("failed", None)
        self.status.update(
            slot, student=job.student, question=job.question.id or "?", exam=job.exam
        )
        with _Renewer(self.server, submission, self.lease, self._say):
            try:
                grader = self._grader(job.question, slot)
            except PrepareFailed as e:
                self._give_back(submission, f"worker cannot grade now: {e}")
                return ("returned", None)
            if isinstance(grader, ReferenceError):
                self._fail(submission, f"question {job.question.id}: {grader}")
                return ("failed", None)
            self.status.update(slot, phase="grading")
            try:
                report = grader.grade(job.answer)
            except Exception as e:  # the sandbox, the profile or the disk
                self._fail(submission, f"{type(e).__name__}: {e}")
                return ("failed", None)
        self.status.update(slot, phase="sending")
        return self._send(job, report, time.monotonic() - started)

    def _grader(self, question: CodeQuestion, slot: int) -> Grader | ReferenceError:
        """
        The prepared grader of a question, or why it cannot be graded. The
        first job of a question prepares it; the others wait.

        Raises:
            PrepareFailed: the profile could not be prepared, now or since
                the last pause of the claims; nothing is cached.
        """
        key = question_hash(question)
        with self._lock:
            lock = self._question_locks.setdefault(key, threading.Lock())
        if not lock.acquire(blocking=False):
            self.status.update(slot, phase="waiting")
            lock.acquire()
        try:
            if key in self._graders:
                return self._graders[key]
            with self._lock:
                failure = self._unprepared.get(key)
            if failure is not None:
                raise failure
            self.status.update(slot, phase="preparing")
            try:
                grader = self.make_grader(question)
                grader.prepare()
                self._graders[key] = grader
            except ReferenceError as e:
                self._say(f"question {question.id}: {e}")
                self._graders[key] = e
            except PrepareFailed as e:
                # Dozens of lines of the tools: the display shows the first;
                # the log and the job given back carry them all.
                self.status.log(next(iter(str(e).splitlines()), "cannot prepare the question"))
                self.log(str(e))
                with self._lock:
                    self._unprepared[key] = e
                    self._backoff = True
                raise
            return self._graders[key]
        finally:
            lock.release()

    def _send(self, job: Job, report: RunnerReport, seconds: float) -> Outcome:
        body = report.model_dump(by_alias=True, exclude_none=True, mode="json")
        try:
            answer = self.server.result(job.submission, body)
        except Conflict as e:
            self._say(f"{job.student} {job.question.id} skipped: {e}")
            return ("skipped", None)
        except (ApiError, httpx.HTTPError) as e:
            self._say(f"{job.student} {job.question.id} result refused: {e}")
            self._fail(job.submission, f"result refused: {e}")
            return ("failed", None)
        outcome = str(answer.get("status") or report.status)
        score = answer.get("score")
        score = None if score is None else str(score)
        self._say(
            f"{job.student} {job.question.id} {outcome}"
            + (f" {score}" if score is not None else "")
            + f" {seconds:.1f}s"
        )
        return (outcome, score)

    def _fail(self, submission: str, error: str, retry: bool = True) -> None:
        self._say(f"{submission} failed: {error.splitlines()[0] if error else ''}")
        try:
            self.server.fail(submission, error[:MAX_ERROR], retry)
        except (ApiError, httpx.HTTPError) as e:
            self._say(f"{submission}: could not report the failure: {e}")

    def _give_back(self, submission: str, reason: str) -> None:
        try:
            self.server.fail(submission, reason[:MAX_ERROR], False)
        except (ApiError, httpx.HTTPError) as e:
            self._say(f"{submission}: could not give back: {e}")

    def _say(self, line: str) -> None:
        self.status.log(line)
        self.log(line)


class _Renewer:
    """
    Renews the lease of a job at half its length while the job is processed.
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
