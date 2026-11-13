"""
Grading with the real elm-test profile. Slow: the first prepare downloads
the Elm packages.
"""

import pytest
from conftest import SOLUTION, needs_elm, question_doc
from mdq.models import CodeQuestion

from chalk_worker.grading import QuestionGrader, ReferenceError

pytestmark = needs_elm

WRONG = SOLUTION.replace("List.sum xs", "List.foldl (+) 1 xs")
BROKEN = SOLUTION.replace("List.sum xs", "List.sum xs +")
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
