"""
Grading a question whose tests are only `expr ==> value` examples, with the
real elm-test profile.
"""

import pytest
from conftest import needs_elm
from mdq.models import CodeQuestion

from chalk_worker.grading import QuestionGrader, ReferenceError

pytestmark = needs_elm

EXAMPLES = """\
collatzLength 5 ==> 6
collatzLength -42 ==> 0
collatzLength 0 ==> 0
collatzLength 1 ==> 1 -- a sequência é só o 1
collatzLength 6 ==> 9 -- 6, 3, 10, 5, 16, 8, 4, 2, 1
"""

SOLUTION = """\
collatzLength : Int -> Int
collatzLength n =
    if n <= 0 then
        0

    else if n == 1 then
        1

    else if modBy 2 n == 0 then
        1 + collatzLength (n // 2)

    else
        1 + collatzLength (3 * n + 1)
"""

#: Wrong for the negative input only.
WRONG = SOLUTION.replace("if n <= 0 then\n        0", "if n == 0 then\n        0")


def question(tests: str = EXAMPLES, **overrides) -> CodeQuestion:
    doc = {
        "id": "elm-collatz",
        "type": "code",
        "stem": "Collatz.",
        "language": "elm",
        "file": "Main.elm",
        "tests": [{"format": "elm", "text": tests}],
        "answerKey": f"```elm\n{SOLUTION}```\n",
        "meta": {"worker": "elm-test"},
    }
    doc.update(overrides)
    return CodeQuestion.model_validate(doc)


@pytest.fixture(scope="module")
def grader(tmp_path_factory) -> QuestionGrader:
    g = QuestionGrader(question(), tmp_path_factory.mktemp("work"), sandbox="none")
    g.prepare()
    return g


def test_reference_passes_every_example(grader) -> None:
    report = grader.grade(SOLUTION)
    assert report.status == "completed"
    assert {c.verdict for c in report.cases} == {"pass"}
    assert [(c.source, c.line) for c in sorted(report.cases, key=lambda c: c.line)] == [
        (0, n) for n in range(1, 6)
    ]
    assert {c.id for c in report.cases} >= {
        "collatzLength -42 ==> 0",
        "collatzLength 1 ==> 1 (a sequência é só o 1)",
    }


def test_wrong_answer_fails_only_the_right_example(grader) -> None:
    report = grader.grade(WRONG)
    failed = [c for c in report.cases if c.verdict == "fail"]
    assert [(c.id, c.line) for c in failed] == [("collatzLength -42 ==> 0", 2)]
    assert failed[0].message


def test_answer_with_its_own_header_still_works(grader) -> None:
    report = grader.grade("module Main exposing (collatzLength)\n\n" + SOLUTION)
    assert {c.verdict for c in report.cases} == {"pass"}


def test_invalid_line_is_an_error_of_the_question(tmp_path) -> None:
    g = QuestionGrader(
        question("collatzLength 5 ==> 6\ncollatzLength 6\n"), tmp_path, sandbox="none"
    )
    with pytest.raises(ReferenceError, match="test source 0: line 2"):
        g.prepare()
