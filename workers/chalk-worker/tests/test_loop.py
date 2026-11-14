"""
The claim loop, with a fake server and a fake grader.
"""

import threading
import time

from conftest import job_doc, question_doc
from mdq.models import RunnerReport

from chalk_worker.client import Conflict
from chalk_worker.grading import PrepareFailed, ReferenceError
from chalk_worker.loop import Filters, Worker


class FakeServer:
    """
    A queue of jobs; a claim takes up to `limit` of them.
    """

    def __init__(self, jobs: list[dict]) -> None:
        self.queue = list(jobs)
        self.claims: list[dict] = []
        self.results: dict[str, dict] = {}
        self.fails: list[tuple[str, str, bool]] = []
        self.renews: list[str] = []
        self.conflict_on_result: set[str] = set()
        self._lock = threading.Lock()

    def claim(self, workers, *, limit, lease, **filters):
        with self._lock:
            self.claims.append({"workers": workers, "limit": limit, "lease": lease, **filters})
            taken, self.queue = self.queue[:limit], self.queue[limit:]
            return taken

    def renew(self, submission, lease):
        with self._lock:
            self.renews.append(submission)

    def fail(self, submission, error, retry):
        with self._lock:
            self.fails.append((submission, error, retry))
            if not retry:
                self.queue.append(job_doc(submission=submission))

    def result(self, submission, report):
        if submission in self.conflict_on_result:
            raise Conflict(409, "closed")
        with self._lock:
            self.results[submission] = report
        return {"state": "DONE", "status": "GRADED_AUTOMATICALLY", "score": "1"}


class FakeGrader:
    def __init__(
        self,
        delay: float = 0,
        error: Exception | None = None,
        prepare_failures: int = 0,
        prepare_delay: float = 0,
    ) -> None:
        self.delay = delay
        self.error = error
        self.prepare_failures = prepare_failures
        self.prepare_delay = prepare_delay
        self.prepared = 0
        self.graded: list[str] = []
        self.running = 0
        self.most_running = 0
        self._lock = threading.Lock()

    def prepare(self) -> None:
        time.sleep(self.prepare_delay)
        self.prepared += 1
        if self.prepared <= self.prepare_failures:
            raise PrepareFailed("cannot download elm/html")
        if isinstance(self.error, ReferenceError):
            raise self.error

    def grade(self, answer: str) -> RunnerReport:
        with self._lock:
            self.running += 1
            self.most_running = max(self.most_running, self.running)
        try:
            time.sleep(self.delay)
            if self.error is not None:
                raise self.error
            with self._lock:
                self.graded.append(answer)
            return RunnerReport(status="completed", cases=[])
        finally:
            with self._lock:
                self.running -= 1


def worker(server, grader, **kw) -> Worker:
    defaults = dict(workers=["elm-test"], poll=0.01, lease=120, log=lambda _: None)
    return Worker(server, lambda question: grader, **(defaults | kw))


def jobs(*names: str) -> list[dict]:
    return [job_doc(submission=name) for name in names]


def test_once_grades_until_the_queue_is_empty() -> None:
    server = FakeServer(jobs("a", "b", "c"))
    assert worker(server, FakeGrader(), batch=2).run(once=True) == 3
    assert set(server.results) == {"a", "b", "c"}
    assert server.results["a"]["status"] == "completed"


def test_claim_carries_filters_and_free_slots() -> None:
    server = FakeServer([])
    w = worker(server, FakeGrader(), jobs=3, lease=60, filters=Filters(exam="teste-1"))
    w.run(once=True)
    assert server.claims == [{"workers": ["elm-test"], "limit": 3, "lease": 60, "exam": "teste-1"}]


def test_batch_caps_the_claim() -> None:
    server = FakeServer([])
    worker(server, FakeGrader(), jobs=8, batch=2).run(once=True)
    assert server.claims[0]["limit"] == 2


def test_one_slot_claims_one_job_at_a_time() -> None:
    server = FakeServer(jobs("a", "b"))
    worker(server, FakeGrader()).run(once=True)
    assert [c["limit"] for c in server.claims] == [1, 1, 1]


def test_slots_grade_in_parallel() -> None:
    server = FakeServer(jobs(*"abcdefgh"))
    grader = FakeGrader(delay=0.2)
    started = time.monotonic()
    assert worker(server, grader, jobs=4).run(once=True) == 8
    elapsed = time.monotonic() - started
    assert set(server.results) == set("abcdefgh")
    assert grader.most_running == 4
    assert elapsed < 0.2 * 8 / 2


def test_question_is_prepared_once_by_parallel_jobs() -> None:
    server = FakeServer(jobs("a", "b", "c", "d"))
    grader = FakeGrader(prepare_delay=0.2)
    w = worker(server, grader, jobs=4)
    w.run(once=True)
    assert grader.prepared == 1
    assert set(server.results) == {"a", "b", "c", "d"}


def test_each_question_gets_its_grader() -> None:
    other = question_doc(id="elm-outra")
    server = FakeServer([job_doc(submission="a"), job_doc(submission="b", question=other)])
    made: list[str] = []

    def make(question):
        made.append(question.id)
        return FakeGrader()

    Worker(server, make, workers=["elm-test"], jobs=2, poll=0.01, log=lambda _: None).run(once=True)
    assert sorted(made) == ["elm-outra", "elm-soma"]


def test_infrastructure_error_fails_with_retry() -> None:
    server = FakeServer(jobs("a"))
    worker(server, FakeGrader(error=RuntimeError("sandbox died"))).run(once=True)
    ((submission, error, retry),) = server.fails
    assert (submission, retry) == ("a", True)
    assert "sandbox died" in error
    assert server.results == {}


def test_broken_reference_fails_every_job_of_the_question_without_grading() -> None:
    server = FakeServer(jobs("a", "b"))
    grader = FakeGrader(error=ReferenceError("reference scores 1/2"))
    worker(server, grader, jobs=2).run(once=True)
    assert sorted((s, retry) for s, _, retry in server.fails) == [("a", True), ("b", True)]
    assert all("reference" in e for _, e, _ in server.fails)
    assert grader.prepared == 1
    assert grader.graded == []


def test_prepare_failure_gives_the_jobs_of_the_question_back_and_stops_once() -> None:
    server = FakeServer(jobs("a", "b", "c"))
    grader = FakeGrader(prepare_failures=1, prepare_delay=0.05)
    assert worker(server, grader, jobs=2).run(once=True) == 0
    assert sorted((s, retry) for s, _, retry in server.fails) == [("a", False), ("b", False)]
    assert "elm/html" in server.fails[0][1]
    assert grader.prepared == 1
    assert len(server.claims) == 1


def test_prepare_failure_is_tried_again_after_a_wait() -> None:
    server = FakeServer(jobs("a"))
    grader = FakeGrader(prepare_failures=1)
    log: list[str] = []
    w = worker(server, grader, log=log.append)
    threading.Timer(0.3, w.stop).start()
    w.run()
    assert grader.prepared == 2
    assert set(server.results) == {"a"}
    assert any("waiting" in line for line in log)


def test_prepare_failure_shows_its_first_line_and_logs_it_all() -> None:
    server = FakeServer(jobs("a"))
    grader = FakeGrader()
    grader.prepare = lambda: (_ for _ in ()).throw(PrepareFailed("elm failed\nline 2\nline 3"))
    log: list[str] = []
    w = worker(server, grader, log=log.append)
    w.run(once=True)
    assert "elm failed\nline 2\nline 3" in log
    assert [line for _, line in w.status.lines_after(0)] == ["elm failed"]
    assert "line 3" in server.fails[0][1]


def test_unparsable_job_fails_with_retry() -> None:
    bad = job_doc(submission="a")
    bad["question"] = {"id": "q", "type": "essay", "stem": "s"}
    server = FakeServer([bad])
    worker(server, FakeGrader()).run(once=True)
    assert [(s, r) for s, _, r in server.fails] == [("a", True)]


def test_conflict_on_result_is_skipped() -> None:
    server = FakeServer(jobs("a", "b"))
    server.conflict_on_result = {"a"}
    w = worker(server, FakeGrader())
    assert w.run(once=True) == 2
    assert set(server.results) == {"b"}
    assert server.fails == []
    snapshot = w.status.snapshot()
    assert (snapshot.graded, snapshot.skipped) == (1, 1)


def test_lease_is_renewed_while_grading() -> None:
    server = FakeServer(jobs("a"))
    worker(server, FakeGrader(delay=0.35), lease=0.2).run(once=True)
    assert server.renews.count("a") >= 2


def test_lease_is_renewed_while_preparing() -> None:
    server = FakeServer(jobs("a"))
    worker(server, FakeGrader(prepare_delay=0.35), lease=0.2).run(once=True)
    assert server.renews.count("a") >= 2


def test_stop_finishes_the_jobs_in_progress_and_claims_no_more() -> None:
    server = FakeServer(jobs("a", "b", "c", "d"))
    w = worker(server, FakeGrader(delay=0.2), jobs=2)
    threading.Timer(0.1, w.stop).start()
    assert w.run() == 2
    assert set(server.results) == {"a", "b"}
    assert server.fails == []
    assert len(server.queue) == 2


def test_stop_interrupts_the_wait_on_an_empty_queue() -> None:
    server = FakeServer([])
    w = worker(server, FakeGrader(), poll=30)
    threading.Timer(0.1, w.stop).start()
    started = time.monotonic()
    w.run()
    assert time.monotonic() - started < 5


def test_pause_stops_claiming_until_resumed() -> None:
    server = FakeServer(jobs("a"))
    w = worker(server, FakeGrader())
    w.pause()
    thread = threading.Thread(target=w.run, kwargs={"once": True})
    thread.start()
    time.sleep(0.1)
    assert server.claims == []
    assert w.status.snapshot().state == "paused"
    w.resume()
    thread.join(5)
    assert set(server.results) == {"a"}


def test_status_shows_the_jobs_in_progress() -> None:
    server = FakeServer(jobs("a", "b"))
    w = worker(server, FakeGrader(delay=0.3), jobs=2)
    thread = threading.Thread(target=w.run, kwargs={"once": True})
    thread.start()
    time.sleep(0.15)
    snapshot = w.status.snapshot()
    thread.join(5)
    assert snapshot.busy == 2
    assert {s.phase for s in snapshot.slots if s} == {"grading"}
    assert {s.student for s in snapshot.slots if s} == {"joao"}
    final = w.status.snapshot()
    assert final.busy == 0
    assert [f.submission for f in final.finished] in (["a", "b"], ["b", "a"])
    assert final.finished[0].outcome == "GRADED_AUTOMATICALLY"


GiB = 1024**3
MiB = 1024**2


def test_memory_caps_the_jobs_claimed() -> None:
    server = FakeServer(jobs(*"abcdefgh"))
    grader = FakeGrader(delay=0.1)
    w = worker(
        server, grader, jobs=8, memory=512 * MiB, reserve=512 * MiB, available=lambda: 5 * GiB / 2
    )
    assert w.run(once=True) == 8
    assert server.claims[0]["limit"] == 4
    assert grader.most_running == 4


def test_low_memory_waits_and_claims_when_memory_frees() -> None:
    server = FakeServer(jobs("a"))
    memory = [256 * MiB]
    w = worker(server, FakeGrader(), memory=512 * MiB, available=lambda: memory[0])
    thread = threading.Thread(target=w.run)
    thread.start()
    time.sleep(0.1)
    assert server.claims == []
    assert w.status.snapshot().state.startswith("low memory")
    memory[0] = 4 * GiB
    time.sleep(0.2)
    w.stop()
    thread.join(5)
    assert set(server.results) == {"a"}


def test_once_without_memory_stops() -> None:
    server = FakeServer(jobs("a"))
    log: list[str] = []
    w = worker(server, FakeGrader(), memory=GiB, available=lambda: GiB, log=log.append)
    assert w.run(once=True) == 0
    assert server.claims == []
    assert any("not enough memory" in line for line in log)


def test_unknown_memory_does_not_limit() -> None:
    server = FakeServer(jobs("a", "b"))
    w = worker(server, FakeGrader(), jobs=2, memory=GiB, available=lambda: None)
    assert w.run(once=True) == 2
