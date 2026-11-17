import os

# Typer colors the help when it sees GITHUB_ACTIONS, which puts escape codes
# inside the option names the tests look for. Read when typer is imported.
os.environ["_TYPER_FORCE_DISABLE_TERMINAL"] = "1"

import shutil
from pathlib import Path

import pytest
from mdq.models import CodeQuestion

from chalk_worker.grading import PrepareFailed, QuestionGrader

HAS_ELM = bool(shutil.which("elm") and shutil.which("elm-test") and shutil.which("node"))

needs_elm = pytest.mark.skipif(not HAS_ELM, reason="elm, elm-test and node needed")

PRETESTS = """\
module Pre exposing (tests)

import Expect
import Main exposing (soma)
import Test exposing (Test, describe, test)


-- mdq: [0] {public} Soma a lista vazia e um elemento
tests : Test
tests =
    describe "pre"
        [ test "vazia" <| \\_ -> Expect.equal 0 (soma [])
        , test "um" <| \\_ -> Expect.equal 7 (soma [ 7 ])
        ]
"""

HIDDEN = """\
module Hidden exposing (tests)

import Expect
import Main exposing (soma)
import Test exposing (Test, describe, test)


tests : Test
tests =
    describe "hidden"
        [ -- mdq: [+2] Soma listas longas
          test "longa" <| \\_ -> Expect.equal 55 (soma (List.range 1 10))
        , -- mdq: [+1] Soma negativos
          test "negativos" <| \\_ -> Expect.equal -3 (soma [ -1, -2 ])
        ]
"""

SOLUTION = "module Main exposing (soma)\n\n\nsoma : List Int -> Int\nsoma xs =\n    List.sum xs\n"


def question_doc(**overrides) -> dict:
    doc = {
        "id": "elm-soma",
        "type": "code",
        "stem": "Some a lista.",
        "language": "elm",
        "file": "Main.elm",
        "tests": [{"format": "elm", "text": PRETESTS}, {"format": "elm", "text": HIDDEN}],
        "answerKey": f"```elm\n{SOLUTION}```\n",
        "meta": {"worker": "elm-test"},
    }
    doc.update(overrides)
    return doc


def job_doc(answer: str = SOLUTION, **overrides) -> dict:
    doc = {
        "submission": "sub1",
        "kind": "SUBMIT",
        "worker": "elm-test",
        "question": question_doc(),
        "exam": "teste-1",
        "course": "cs101/ada_2026-1",
        "student": "joao",
        "answer": answer,
        "leaseUntil": "2026-11-13T14:00:00Z",
    }
    doc.update(overrides)
    return doc


@pytest.fixture
def question() -> CodeQuestion:
    return CodeQuestion.model_validate(question_doc())


@pytest.fixture(scope="session")
def elm_cache(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("elm-cache")


def prepare(grader: QuestionGrader) -> None:
    """
    Prepare a grader, skipping the test when the Elm packages cannot be
    downloaded: they come from package.elm-lang.org and GitHub, and elm does
    not retry, so a DNS hiccup fails the download.
    """
    try:
        grader.prepare()
    except PrepareFailed as e:
        if any(m in str(e) for m in ("package.elm-lang.org", "PROBLEM DOWNLOADING")):
            pytest.skip(f"cannot download the elm packages: {e}")
        raise
