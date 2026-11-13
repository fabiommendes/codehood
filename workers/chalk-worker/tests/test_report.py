"""
The conversion of a chalk-grader run into an mdq runner report.
"""

from fractions import Fraction
from hashlib import sha256

from chalk_grader import disqualification as dq
from chalk_grader.graded import Graded
from conftest import SOLUTION
from mdq.models import RunnerReport

from chalk_worker.report import Run, to_report

EXPECTED = {
    ("Pre pre", "vazia"): "vazia",
    ("Pre pre", "um"): "um",
    ("Hidden hidden", "longa"): "longa",
    ("Hidden hidden", "negativos"): "negativos",
}


def run(graded: Graded, results: dict | None) -> RunnerReport:
    return to_report(Run(graded=graded, results=results, expected=EXPECTED), _q(), SOLUTION)


def _q():
    from conftest import question_doc
    from mdq.models import CodeQuestion

    return CodeQuestion.model_validate(question_doc())


def verdicts(report: RunnerReport) -> dict[tuple[int, int], str]:
    return {(c.source, c.line): c.verdict for c in report.cases}


def test_completed_run_maps_each_expected_case_to_its_line() -> None:
    results = {
        ("Pre pre", "vazia"): None,
        ("Pre pre", "um"): None,
        ("Hidden hidden", "longa"): "55\n\nwas not equal to\n\n54",
        ("Hidden hidden", "negativos"): None,
    }
    report = run(Graded(Fraction(3, 4)), results)
    assert report.status == "completed"
    assert verdicts(report) == {(0, 12): "pass", (0, 13): "pass", (1, 12): "fail", (1, 14): "pass"}
    longa = next(c for c in report.cases if c.line == 12 and c.source == 1)
    assert longa.id == "longa"
    assert "was not equal to" in (longa.message or "")


def test_expected_case_missing_from_the_run_fails() -> None:
    results = {("Pre pre", "vazia"): None}
    report = run(Graded(Fraction(1, 4)), results)
    assert verdicts(report)[(0, 13)] == "fail"
    assert verdicts(report)[(1, 12)] == "fail"


def test_cases_the_student_added_are_ignored() -> None:
    results = {key: None for key in EXPECTED} | {("Main", "sneaky"): None}
    report = run(Graded(Fraction(1)), results)
    assert len(report.cases) == 4


def test_case_without_a_line_is_omitted() -> None:
    expected = EXPECTED | {("Pre pre", "ghost"): "ghost"}
    graded = Graded(Fraction(1))
    report = to_report(
        Run(graded=graded, results={k: None for k in expected}, expected=expected), _q(), SOLUTION
    )
    assert len(report.cases) == 4


def test_build_error() -> None:
    graded = Graded(dq.BuildError(), feedback="The code does not compile:\n-- NAMING ERROR")
    report = run(graded, None)
    assert report.status == "build-error"
    assert report.build == "-- NAMING ERROR"
    assert report.cases == []


def test_invalid_input_is_a_build_error() -> None:
    report = run(Graded(dq.InvalidInput(), feedback="Answer too large."), None)
    assert report.status == "build-error"


def test_timeout_of_the_whole_run_times_out_every_case() -> None:
    report = run(Graded(dq.Timeout()), None)
    assert report.status == "completed"
    assert set(verdicts(report).values()) == {"timeout"}
    assert len(report.cases) == 4


def test_infrastructure_error_is_a_runner_error() -> None:
    report = run(Graded(dq.Error(), feedback="sandbox died"), None)
    assert report.status == "runner-error"
    assert report.message == "sandbox died"


def test_completed_without_captured_results_is_a_runner_error() -> None:
    report = run(Graded(Fraction(1)), None)
    assert report.status == "runner-error"


def test_report_identifies_the_runner_and_hashes() -> None:
    report = run(Graded(Fraction(1)), {k: None for k in EXPECTED})
    assert report.runner is not None and report.runner.name == "chalk-worker"
    assert report.runner.language == "elm"
    assert report.hashes is not None
    assert report.hashes.submission == sha256(SOLUTION.encode()).hexdigest()
    assert len(report.hashes.sources or []) == 2
