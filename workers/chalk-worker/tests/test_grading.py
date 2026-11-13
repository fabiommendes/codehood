"""
Grading with the real elm-test profile. Slow: the first prepare downloads
the Elm packages.
"""

from pathlib import Path

import pytest
from conftest import SOLUTION, needs_elm, question_doc
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
    g.prepare()
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
