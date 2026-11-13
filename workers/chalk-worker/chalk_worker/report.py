"""
Turn a chalk-grader run into an mdq runner report.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from fractions import Fraction
from hashlib import sha256

from chalk_grader import disqualification as dq
from chalk_grader.graded import Graded
from mdq.models import CodeQuestion, ReportCase, RunnerReport

from . import __version__
from .locate import elm_module, locate_elm

__all__ = ["Run", "clean_build", "to_report"]

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

#: Message of every case when the answer crashed the test runner.
CRASHED = "the tests did not run: the answer compiles but crashes when loaded"

#: Lines of compiler progress that say nothing about the answer.
_PROGRESS = re.compile(
    r"^\s*$|^(Starting downloads|Verifying dependencies|Dependencies ready|Compiling \.\.\.)"
    r"|^\s*●"
)

#: The temporary directory chalk-grader builds the answer in.
_ANSWER_DIR = re.compile(r"/\S*?chalk-answer-[^/\s]*/")


@dataclass(frozen=True)
class Run:
    """
    What a run of the profile grader left behind.
    """

    #: The grade, with the outcome of each expected test in `cases` when the
    #: run produced a test report.
    graded: Graded | None
    #: The tests of the reference run, which the answer is held to.
    expected: Mapping[TestKey, str]
    #: The run failed without a test report while the reference solution
    #: still passes, so the answer itself broke the test runner.
    crashed: bool = False


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
        build = clean_build((graded.feedback or "").removeprefix(BUILD_PREFIX)) or None
        return RunnerReport(status="build-error", cases=[], build=build, **base)
    if score == dq.Timeout():
        cases = _cases(run, question, lambda _: ("timeout", "time limit exceeded"))
        return RunnerReport(status="completed", cases=cases, **base)
    if run.crashed:
        detail = (graded.feedback or "").strip()
        message = f"{CRASHED} ({detail})" if detail else CRASHED
        cases = _cases(run, question, lambda _: ("error", message[:MAX_MESSAGE]))
        return RunnerReport(status="completed", cases=cases, message=message, **base)
    if not isinstance(score, Fraction | int) or graded.cases is None:
        return RunnerReport(
            status="runner-error", cases=[], message=graded.feedback or "grading failed", **base
        )

    outcome = {case.key: case for case in graded.cases}

    def verdict(key: TestKey) -> tuple[str, str | None]:
        case = outcome.get(key)
        if case is None:
            return "fail", "not run"
        if case.passed:
            return "pass", None
        return "fail", (case.message or "")[:MAX_MESSAGE] or None

    return RunnerReport(status="completed", cases=_cases(run, question, verdict), **base)


def clean_build(text: str) -> str:
    """
    The compiler output without progress lines and with paths relative to
    the project, as the student wrote them.
    """
    lines = [line for line in text.splitlines() if not _PROGRESS.match(line)]
    first = next((i for i, line in enumerate(lines) if line.strip()), len(lines))
    return _ANSWER_DIR.sub("", "\n".join(lines[first:])).strip()


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
        # The generated module of an examples block is an implementation
        # detail: its tests are shown by the name of the example alone.
        shown = key[1] if elm_module(texts[source]) is None else name or key[1]
        cases.append(ReportCase(source=source, line=line, verdict=status, id=shown, **fields))
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
