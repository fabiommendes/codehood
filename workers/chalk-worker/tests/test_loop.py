"""
The claim loop, with a fake server and a fake grader.
"""

import threading
import time

from conftest import job_doc
from mdq.models import RunnerReport

from chalk_worker.client import Conflict
from chalk_worker.grading import ReferenceError
from chalk_worker.loop import Filters, Worker


class FakeServer:
    def __init__(self, batches: list[list[dict]]) -> None:
        self.batches = list(batches)
        self.claims: list[dict] = []
        self.results: dict[str, dict] = {}
        self.fails: list[tuple[str, str, bool]] = []
        self.renews: list[str] = []
        self.conflict_on_result: set[str] = set()

    def claim(self, workers, *, limit, lease, **filters):
        self.claims.append({"workers": workers, "limit": limit, "lease": lease, **filters})
        return self.batches.pop(0) if self.batches else []

    def renew(self, submission, lease):
        self.renews.append(submission)

    def fail(self, submission, error, retry):
        self.fails.append((submission, error, retry))

    def result(self, submission, report):
        if submission in self.conflict_on_result:
            raise Conflict(409, "closed")
        self.results[submission] = report
        return {"state": "DONE", "status": "GRADED_AUTOMATICALLY", "score": "1"}


class FakeGrader:
    def __init__(self, delay: float = 0, error: Exception | None = None) -> None:
        self.delay = delay
        self.error = error
        self.prepared = 0
        self.graded: list[str] = []

    def prepare(self) -> None:
        self.prepared += 1
        if isinstance(self.error, ReferenceError):
            raise self.error

    def grade(self, answer: str) -> RunnerReport:
        time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        self.graded.append(answer)
        return RunnerReport(status="completed", cases=[])


def worker(server, grader, **kw) -> Worker:
    defaults = dict(workers=["elm-test"], batch=4, poll=0.01, lease=120, log=lambda _: None)
    return Worker(server, lambda question: grader, **(defaults | kw))


def test_once_grades_until_the_queue_is_empty() -> None:
    server = FakeServer(
        [[job_doc(submission="a"), job_doc(submission="b")], [job_doc(submission="c")]]
    )
    grader = FakeGrader()
    assert worker(server, grader).run(once=True) == 3
    assert set(server.results) == {"a", "b", "c"}
    assert server.results["a"]["status"] == "completed"
    assert len(server.claims) == 3


def test_claim_carries_filters_and_batch() -> None:
    server = FakeServer([])
    w = worker(server, FakeGrader(), batch=2, lease=60, filters=Filters(exam="teste-1"))
    w.run(once=True)
    assert server.claims == [{"workers": ["elm-test"], "limit": 2, "lease": 60, "exam": "teste-1"}]


def test_question_is_prepared_once() -> None:
    server = FakeServer([[job_doc(submission="a"), job_doc(submission="b")]])
    grader = FakeGrader()
    worker(server, grader).run(once=True)
    assert grader.prepared == 1


def test_infrastructure_error_fails_with_retry() -> None:
    server = FakeServer([[job_doc(submission="a")]])
    worker(server, FakeGrader(error=RuntimeError("sandbox died"))).run(once=True)
    ((submission, error, retry),) = server.fails
    assert (submission, retry) == ("a", True)
    assert "sandbox died" in error
    assert server.results == {}


def test_broken_reference_fails_every_job_of_the_question_without_grading() -> None:
    server = FakeServer([[job_doc(submission="a"), job_doc(submission="b")]])
    grader = FakeGrader(error=ReferenceError("reference scores 1/2"))
    worker(server, grader).run(once=True)
    assert [(s, retry) for s, _, retry in server.fails] == [("a", True), ("b", True)]
    assert all("reference" in e for _, e, _ in server.fails)
    assert grader.prepared == 1
    assert grader.graded == []


def test_unparsable_job_fails_with_retry() -> None:
    bad = job_doc(submission="a")
    bad["question"] = {"id": "q", "type": "essay", "stem": "s"}
    server = FakeServer([[bad]])
    worker(server, FakeGrader()).run(once=True)
    assert [(s, r) for s, _, r in server.fails] == [("a", True)]


def test_conflict_on_result_is_skipped() -> None:
    server = FakeServer([[job_doc(submission="a"), job_doc(submission="b")]])
    server.conflict_on_result = {"a"}
    assert worker(server, FakeGrader()).run(once=True) == 2
    assert set(server.results) == {"b"}
    assert server.fails == []


def test_lease_is_renewed_while_grading() -> None:
    server = FakeServer([[job_doc(submission="a")]])
    worker(server, FakeGrader(delay=0.35), lease=0.2).run(once=True)
    assert server.renews.count("a") >= 2


def test_stop_returns_the_rest_of_the_batch_without_retry() -> None:
    server = FakeServer(
        [[job_doc(submission="a"), job_doc(submission="b"), job_doc(submission="c")]]
    )
    w = worker(server, FakeGrader(delay=0.2))
    threading.Timer(0.1, w.stop).start()
    w.run()
    assert set(server.results) == {"a"}
    assert sorted((s, r) for s, _, r in server.fails) == [("b", False), ("c", False)]


def test_stop_interrupts_the_wait_on_an_empty_queue() -> None:
    server = FakeServer([])
    w = worker(server, FakeGrader(), poll=30)
    threading.Timer(0.1, w.stop).start()
    started = time.monotonic()
    w.run()
    assert time.monotonic() - started < 5
