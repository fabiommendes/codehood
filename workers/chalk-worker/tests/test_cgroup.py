"""
Each run in a cgroup of its own, with real Elm answers. These tests need a
delegated cgroup, which pytest gets when started as

    systemd-run --user --scope --quiet --collect -p Delegate=yes \\
        .venv/bin/python -m pytest tests/test_cgroup.py

(not under `uv run`: uv would share the scope). Elsewhere they are skipped.
"""

import re
import threading
from pathlib import Path

import pytest
from chalk_grader import cgroup
from conftest import SOLUTION, job_doc, needs_elm, question_doc
from mdq.models import CodeQuestion
from test_grading import LIST_BOMB, NESTED_BOMB, WRONG
from test_loop import FakeServer

from chalk_worker.grading import PrepareFailed, QuestionGrader
from chalk_worker.loop import Worker

MiB = 1024 * 1024

#: Memory of a run in these tests: the default of the worker. With 256 MiB
#: the build of the reference solution may already go past it.
MEMORY = 512 * MiB

#: Errors of a prepare that the network explains.
NETWORK = re.compile(r"download|connect|resolve|network|http", re.IGNORECASE)

pytestmark = [
    needs_elm,
    pytest.mark.skipif(
        cgroup.controller() is None, reason="needs a delegated cgroup (see the docstring)"
    ),
]


def prepared(workdir: Path, sandbox: str | None = "none") -> QuestionGrader:
    g = QuestionGrader(
        CodeQuestion.model_validate(question_doc()), workdir, sandbox=sandbox, memory=MEMORY
    )
    try:
        g.prepare()
    except PrepareFailed as e:
        if not NETWORK.search(str(e)):
            raise
        pytest.skip(f"cannot download the Elm packages: {e}")
    return g


@pytest.fixture(scope="module")
def grader(tmp_path_factory) -> QuestionGrader:
    return prepared(tmp_path_factory.mktemp("work"))


@pytest.mark.parametrize("answer", [LIST_BOMB, NESTED_BOMB], ids=["list", "nested"])
def test_answer_past_the_memory_of_its_run_gets_memory_limit(grader, answer: str) -> None:
    report = grader.grade(answer)
    assert report.status == "completed"
    assert {c.verdict for c in report.cases} == {"resource-limit"}
    assert len(report.cases) == 4
    assert "512 MiB" in (report.cases[0].message or "")


def test_reference_still_passes_after_a_bomb(grader) -> None:
    grader.grade(LIST_BOMB)
    report = grader.grade(SOLUTION)
    assert {c.verdict for c in report.cases} == {"pass"}


class RunWatcher:
    """
    The memory.max of the cgroups of the runs seen while it watches.
    """

    def __init__(self) -> None:
        controller = cgroup.controller()
        assert controller is not None
        self.root = controller.root
        self.seen: dict[str, str] = {}
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def __enter__(self) -> "RunWatcher":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._done.set()
        self._thread.join()

    def _loop(self) -> None:
        while not self._done.wait(0.02):
            for path in self.root.glob("run-*"):
                try:
                    self.seen.setdefault(path.name, (path / "memory.max").read_text().strip())
                except OSError:
                    pass


def test_worker_grades_a_queue_with_a_bomb_and_goes_on(tmp_path) -> None:
    g = prepared(tmp_path / "work", sandbox=None)  # bwrap, as the worker runs
    server = FakeServer(
        [
            job_doc(submission="bomb", answer=LIST_BOMB),
            job_doc(submission="right", answer=SOLUTION),
            job_doc(submission="wrong", answer=WRONG),
        ]
    )
    worker = Worker(server, lambda _: g, workers=["elm-test"], jobs=2, poll=0.01, log=print)
    with RunWatcher() as runs:
        assert worker.run(once=True) == 3
    assert server.fails == []
    verdicts = {s: {c["verdict"] for c in r["cases"]} for s, r in server.results.items()}
    assert verdicts["bomb"] == {"resource-limit"}
    assert verdicts["right"] == {"pass"}
    assert "fail" in verdicts["wrong"]
    assert runs.seen and set(runs.seen.values()) == {str(MEMORY)}
