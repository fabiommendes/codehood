"""
Turn a chalk-grader run into an mdq runner report.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from fractions import Fraction
from hashlib import sha256

from chalk_grader import disqualification as dq
from chalk_grader.graded import Graded
from mdq.models import CodeQuestion, ReportCase, RunnerReport

from . import __version__
from .locate import locate_elm

__all__ = ["Run", "to_report"]

log = logging.getLogger(__name__)

#: JUnit (classname, name) of a test.
type TestKey = tuple[str, str]

#: Finds the (source, line) of a case from the texts of the sources and its key.
type Locator = Callable[[Sequence[str], str, str], tuple[int, int] | None]

LOCATORS: dict[str, Locator] = {"elm": locate_elm}

#: Start of the feedback chalk-grader writes for a build error.
BUILD_PREFIX = "The code does not compile:"

#: Longest message of a case, in characters.
MAX_MESSAGE = 2000


@dataclass(frozen=True)
class Run:
    """
    What a run of the profile grader left behind.
    """

    graded: Graded | None
    #: Outcome of each test of the JUnit report: None when it passed, else
    #: the failure message. None when the run produced no report.
    results: Mapping[TestKey, str | None] | None
    #: The tests of the reference run, which the answer is held to.
    expected: Mapping[TestKey, str]


def to_report(run: Run, question: CodeQuestion, answer: str) -> RunnerReport:
    """
    The runner report of a run, with one case for each expected test that
    the locator of the language finds in the sources.
    """
    graded = run.graded
    base = _base(question, answer)
    if graded is None:
        return RunnerReport(status="runner-error", cases=[], message="not graded", **base)

    score = graded.score
    if score == dq.BuildError() or score == dq.InvalidInput():
        build = (graded.feedback or "").removeprefix(BUILD_PREFIX).strip() or None
        return RunnerReport(status="build-error", cases=[], build=build, **base)
    if score == dq.Timeout():
        cases = _cases(run, question, lambda _: ("timeout", "time limit exceeded"))
        return RunnerReport(status="completed", cases=cases, **base)
    if not isinstance(score, Fraction | int) or run.results is None:
        return RunnerReport(
            status="runner-error", cases=[], message=graded.feedback or "grading failed", **base
        )

    results = run.results

    def verdict(key: TestKey) -> tuple[str, str | None]:
        if key not in results:
            return "fail", "not run"
        message = results[key]
        return ("pass", None) if message is None else ("fail", message[:MAX_MESSAGE] or None)

    return RunnerReport(status="completed", cases=_cases(run, question, verdict), **base)


def _cases(
    run: Run, question: CodeQuestion, verdict: Callable[[TestKey], tuple[str, str | None]]
) -> list[ReportCase]:
    locate = LOCATORS.get(question.language or "")
    texts = [source.text or "" for source in question.tests]
    cases: list[ReportCase] = []
    for key, name in run.expected.items():
        where = locate(texts, *key) if locate else None
        if where is None:
            log.warning("test %r of question %s not found in its sources", key, question.id)
            continue
        status, message = verdict(key)
        source, line = where
        fields = {"message": message} if message else {}
        cases.append(
            ReportCase(source=source, line=line, verdict=status, id=name or key[1], **fields)
        )
    return cases


def _base(question: CodeQuestion, answer: str) -> dict:
    return {
        "runner": {"name": "chalk-worker", "version": __version__, "language": question.language},
        "hashes": {
            "submission": _digest(answer),
            "sources": [_digest(source.text or "") for source in question.tests],
        },
    }


def _digest(text: str) -> str:
    return sha256(text.encode()).hexdigest()
