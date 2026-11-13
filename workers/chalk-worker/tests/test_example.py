"""
The example course end to end, without a server: the question as the CLI
resolves it, graded by the worker and scored by mdq.
"""

from pathlib import Path

import mdq
import pytest
from conftest import needs_elm

from chalk_worker.grading import QuestionGrader

pytestmark = needs_elm

QUESTION = Path(__file__).parent.parent / "example" / "questions" / "elm" / "soma.md"


@pytest.fixture(scope="module")
def question():
    q = mdq.parse(QUESTION.read_text())
    return q.resolve({t.origin: (QUESTION.parent / t.origin).read_text() for t in q.tests})


@pytest.fixture(scope="module")
def grader(question, tmp_path_factory) -> QuestionGrader:
    g = QuestionGrader(question, tmp_path_factory.mktemp("example"), sandbox="none")
    g.prepare()
    return g


def score(question, grader, answer: str) -> float | None:
    report = grader.grade(answer)
    return question.score_response(answer, report=report).score


def test_reference_scores_one(question, grader) -> None:
    assert score(question, grader, question.reference_solution) == 1


def test_hidden_case_weighs_by_its_item(question, grader) -> None:
    answer = question.reference_solution.replace(
        "List.sum xs", "List.sum (List.filter (\\x -> x > 0) xs)"
    )
    # items [0] pre, [+2] longa, [+1] negativos: fails only negativos.
    assert score(question, grader, answer) == pytest.approx(2 / 3)
