"""
Memory of the runs and failures of the runs that are not the answer's fault,
with a fake profile grader.
"""

import sys
from types import SimpleNamespace

import pytest
from chalk_grader import disqualification as dq
from chalk_grader.graded import Graded
from chalk_grader.script_runner import RunError, RunKilled
from conftest import question_doc
from mdq.models import CodeQuestion

from chalk_worker import cli
from chalk_worker.grading import PrepareFailed, QuestionGrader, ReferenceError, run_vars

MiB = 1024 * 1024

EXPECTED = {
    ("Pre pre", "vazia"): "vazia",
    ("Pre pre", "um"): "um",
    ("Hidden hidden", "longa"): "longa",
    ("Hidden hidden", "negativos"): "negativos",
}


class FakeProfileGrader:
    def __init__(self, outcome: Graded | Exception) -> None:
        self.outcome = outcome

    def prepare(self):
        return SimpleNamespace(tests=EXPECTED)

    def __call__(self, name: str, answer: str) -> Graded:
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def grader(tmp_path, outcome: Graded | Exception, **kw) -> QuestionGrader:
    g = QuestionGrader(CodeQuestion.model_validate(question_doc()), tmp_path, **kw)
    g._grader = FakeProfileGrader(outcome)  # type: ignore[assignment]
    return g


def test_memory_of_a_job_is_the_default_of_the_profile() -> None:
    assert run_vars(512 * MiB) == {"memory_mib": "512"}
    assert run_vars(10**9) == {"memory_mib": "953"}
    assert run_vars(None) == {} == run_vars(0)


def test_grader_passes_the_memory_without_an_address_space_limit(tmp_path) -> None:
    g = QuestionGrader(
        CodeQuestion.model_validate(question_doc()), tmp_path, memory=256 * MiB, sandbox="none"
    )
    conf = g._grader.conf
    assert conf.vars == {"memory_mib": "256"}
    # limits.memory would be RLIMIT_AS without a cgroup, which node cannot start under.
    assert conf.limits.memory is None and conf.limits.address_space is None


def test_run_killed_while_preparing_is_a_prepare_failure(tmp_path) -> None:
    g = grader(tmp_path, RunKilled("the system killed a process of the run, twice"))
    with pytest.raises(PrepareFailed, match="twice"):
        g.prepare()


def test_run_error_while_preparing_is_a_prepare_failure(tmp_path) -> None:
    g = grader(tmp_path, RunError("cannot start the run: no cgroup"))
    with pytest.raises(PrepareFailed, match="no cgroup"):
        g.prepare()


def test_reference_past_the_memory_asks_for_more(tmp_path) -> None:
    g = grader(tmp_path, Graded(dq.MemoryLimit(), feedback="more than 512 MiB"))
    with pytest.raises(ReferenceError, match="--memory"):
        g.prepare()


def test_run_error_while_grading_reaches_the_loop(tmp_path) -> None:
    g = grader(tmp_path, RunKilled("twice"))
    with pytest.raises(RunKilled):
        g.grade("x")


def test_memory_limit_of_an_answer(tmp_path) -> None:
    g = grader(tmp_path, Graded(dq.MemoryLimit(), feedback="more than 512 MiB"))
    report = g.grade("x")
    assert report.status == "completed"
    assert {c.verdict for c in report.cases} == {"resource-limit"}


def test_limits_note_with_and_without_cgroup(monkeypatch) -> None:
    monkeypatch.setattr(cli.cgroup, "controller", lambda: None)
    limited, note = cli._limits_note(512 * MiB)
    assert not limited and "no memory or process limit" in note
    monkeypatch.setattr(cli.cgroup, "controller", lambda: object())
    assert cli._limits_note(512 * MiB) == (True, "each run in a cgroup of its own, with 512 MiB")
    assert "profile's default" in cli._limits_note(None)[1]


@pytest.mark.parametrize(
    ("argv", "setup"),
    [(["chalk-worker", "--once"], True), (["chalk-worker", "--help"], False)],
)
def test_main_sets_up_the_cgroups_before_grading(monkeypatch, argv, setup) -> None:
    calls: list[str] = []
    monkeypatch.setattr(sys, "argv", argv)
    monkeypatch.setattr(cli.cgroup, "reexec_delegated", lambda: calls.append("reexec"))
    monkeypatch.setattr(cli.cgroup, "controller", lambda: calls.append("controller"))
    monkeypatch.setattr(cli, "app", lambda: calls.append("app"))
    cli.main()
    assert calls == (["reexec", "controller", "app"] if setup else ["app"])
