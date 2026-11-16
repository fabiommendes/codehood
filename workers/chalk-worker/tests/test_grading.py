"""
Grading with the real elm-test profile. Slow: the first prepare downloads
the Elm packages.
"""

from pathlib import Path

import pytest
from chalk_grader import cgroup
from chalk_grader.profiles import ReferenceMemoryLimit
from conftest import SOLUTION, needs_elm, prepare, question_doc
from mdq.models import CodeQuestion

from chalk_worker.grading import QuestionGrader, ReferenceError

pytestmark = needs_elm

WRONG = SOLUTION.replace("List.sum xs", "List.foldl (+) 1 xs")
BROKEN = SOLUTION.replace("List.sum xs", "List.sum xs +")
#: Compiles, but crashes when the test runner loads the module.
CRASH = SOLUTION.replace("soma xs =\n    List.sum xs", 'soma =\n    Debug.todo "later"')
NEGATIVES = SOLUTION.replace("List.sum xs", "List.sum (List.filter (\\x -> x > 0) xs)")


@pytest.fixture(scope="module")
def grader(tmp_path_factory) -> QuestionGrader:
    q = CodeQuestion.model_validate(question_doc())
    g = QuestionGrader(q, tmp_path_factory.mktemp("work"), sandbox="none")
    prepare(g)
    return g


def verdicts(report) -> dict[tuple[int, int], str]:
    return {(c.source, c.line): c.verdict for c in report.cases}


def test_reference_passes_everything(grader) -> None:
    report = grader.grade(SOLUTION)
    assert report.status == "completed"
    assert set(verdicts(report).values()) == {"pass"}
    assert len(report.cases) == 4


def test_wrong_answer_fails_the_pretests(grader) -> None:
    report = grader.grade(WRONG)
    v = verdicts(report)
    assert v[(0, 12)] == "fail"
    assert v[(0, 13)] == "fail"


def test_hidden_case_fails_alone(grader) -> None:
    v = verdicts(grader.grade(NEGATIVES))
    assert v == {(0, 12): "pass", (0, 13): "pass", (1, 12): "pass", (1, 14): "fail"}


def test_build_error(grader) -> None:
    report = grader.grade(BROKEN)
    assert report.status == "build-error"
    assert report.build


def test_build_error_hides_the_progress_and_the_workdir(grader) -> None:
    report = grader.grade(BROKEN)
    assert "Verifying dependencies" not in report.build
    assert "/tmp/" not in report.build and "chalk-answer" not in report.build
    assert "src/Main.elm" in report.build


def test_answer_that_crashes_the_runner_errs_every_case(grader) -> None:
    report = grader.grade(CRASH)
    assert report.status == "completed"
    assert set(verdicts(report).values()) == {"error"}
    assert len(report.cases) == 4
    assert "did not run" in (report.cases[0].message or "")


def test_reference_that_fails_is_refused(tmp_path) -> None:
    doc = question_doc(answerKey=f"```elm\n{WRONG}```\n")
    g = QuestionGrader(CodeQuestion.model_validate(doc), tmp_path, sandbox="none")
    with pytest.raises(ReferenceError):
        g.prepare()


def test_reference_past_the_memory_in_prepare_is_refused(tmp_path, monkeypatch) -> None:
    # Not PrepareFailed, which gives the jobs back without spending tries.
    g = QuestionGrader(CodeQuestion.model_validate(question_doc()), tmp_path, sandbox="none")

    def over_memory(_self: object) -> None:
        raise ReferenceMemoryLimit("elm-test", 512 * 1024**2)

    monkeypatch.setattr(type(g._grader), "prepare", over_memory)
    with pytest.raises(ReferenceError, match=r"512 MiB.*--memory"):
        g.prepare()


def test_question_without_reference_is_refused(tmp_path) -> None:
    doc = question_doc()
    del doc["answerKey"]
    g = QuestionGrader(CodeQuestion.model_validate(doc), tmp_path, sandbox="none")
    with pytest.raises(ReferenceError):
        g.prepare()


def test_relative_workdir_is_made_absolute(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    g = QuestionGrader(CodeQuestion.model_validate(question_doc()), Path("cache/q"))
    assert g.workdir == tmp_path / "cache" / "q"


#: Allocates without end, in a list and in a nested structure.
LIST_BOMB = SOLUTION.replace("List.sum xs", "List.length (List.repeat 100000000 xs)")
NESTED_BOMB = SOLUTION.replace(
    "soma xs =\n    List.sum xs",
    "soma xs =\n    grow (N []) 0\n\n\ntype T\n    = N (List T)\n\n\n"
    "grow : T -> Int -> Int\ngrow t n =\n    if n < 0 then\n        0\n\n    else\n"
    "        grow (N [ t, t, N [ t ] ]) (n + 1)\n",
)


@pytest.mark.skipif(
    cgroup.controller() is not None, reason="with a cgroup: see test_cgroup.py (memory-limit)"
)
@pytest.mark.parametrize("answer", [LIST_BOMB, NESTED_BOMB], ids=["list", "nested"])
def test_without_cgroup_the_heap_of_node_errs_every_case(tmp_path: Path, answer: str) -> None:
    # The budget is node's heap alone, with no RLIMIT_AS, so the answer
    # crashes node instead of taking the memory of the machine.
    q = CodeQuestion.model_validate(question_doc())
    g = QuestionGrader(q, tmp_path / "work", sandbox="none", memory=256 * 1024**2)
    prepare(g)
    report = g.grade(answer)
    assert report.status == "completed"
    assert {c.verdict for c in report.cases} == {"error"}
