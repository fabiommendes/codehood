"""
Grade the answers to one `code` question with a chalk-grader profile.

The project the profile runs is built from the question: the test sources
become the test files, the reference solution comes from the answer key and
the answer goes to the file the question names.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from hashlib import sha256
from importlib import resources
from pathlib import Path
from typing import Any

from chalk_grader import models
from chalk_grader.profile_grader import Prepared, ProfileGrader, resolve_profile
from chalk_grader.profiles import PrepareError, junit_results
from chalk_grader.task import Task
from mdq.models import CodeQuestion, RunnerReport

from .locate import elm_module
from .report import Run, TestKey, to_report

__all__ = ["PROFILE_BY_LANGUAGE", "QuestionGrader", "ReferenceError", "question_hash"]

#: The chalk-grader profile of each language a question may declare.
PROFILE_BY_LANGUAGE = {"elm": "elm-test"}


class ReferenceError(ValueError):
    """
    The question cannot be graded: it has no reference solution, the profile
    cannot run it, or the reference solution fails a test.
    """


def question_hash(question: CodeQuestion) -> str:
    """
    A digest of the question document, which changes whenever its tests or
    its answer key do.
    """
    doc = question.model_dump(by_alias=True, exclude_none=True, mode="json")
    return sha256(json.dumps(doc, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class _CapturingGrader(ProfileGrader):
    """
    A profile grader that keeps the outcome of each test of its last run.
    """

    _results: list[dict[TestKey, str | None] | None] = field(
        default_factory=list, compare=False, repr=False
    )

    def _reader(self, prepared: Prepared):
        inner = super()._reader(prepared)

        def read(path: Path, extra):
            self._results.clear()
            try:
                results, _ = junit_results(path.read_text(errors="replace"))
            except Exception:  # an invalid report is the inner reader's to judge
                results = None
            self._results.append(results)
            return inner(path, extra)

        return read

    def last_results(self) -> dict[TestKey, str | None] | None:
        return self._results[0] if self._results else None


class QuestionGrader:
    """
    Grades answers to one question, preparing its project once.
    """

    def __init__(
        self,
        question: CodeQuestion,
        workdir: Path,
        *,
        sandbox: str | None = None,
        timeout: float | None = None,
        profiles: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.question = question
        self.workdir = workdir
        language = question.language or ""
        profile = PROFILE_BY_LANGUAGE.get(language)
        if profile is None:
            raise ReferenceError(f"no profile for language {language!r}")
        self._answer = _answer_path(language, question.file or "")
        self._template = workdir / "template"
        self._grader = _CapturingGrader(
            script=None,
            task=Task(question.id or "question", "codehood", root=workdir, template=self._template),
            conf=models.Autograder(
                profile=profile, answer=self._answer, sandbox=sandbox, timeout=timeout
            ),
            name=profile,
            profile=resolve_profile(profile, profiles or {}),
            solution=question.reference_solution,
            cache_dir=workdir.parent / "cache",
        )

    def prepare(self) -> None:
        """
        Write the project, fill the cache of the profile and check that the
        reference solution passes every test.

        Raises:
            ReferenceError: the question cannot be graded.
        """
        if self.question.reference_solution is None:
            raise ReferenceError("the question has no reference solution (answer key)")
        _write_template(self.question, self._template)
        try:
            self._grader.prepare()
        except (PrepareError, OSError, RuntimeError) as e:
            raise ReferenceError(f"cannot prepare the profile: {e}") from None
        if not self._grader.prepare().tests:
            raise ReferenceError("the reference run found no tests")
        report = self.grade(self.question.reference_solution)
        failed = [c.id for c in report.cases if c.verdict != "pass"]
        if report.status != "completed" or failed:
            detail = report.build or report.message or ", ".join(str(f) for f in failed)
            raise ReferenceError(f"the reference solution does not pass: {report.status} {detail}")

    def grade(self, answer: str) -> RunnerReport:
        """
        The runner report of an answer.

        Raises:
            PrepareError, OSError, RuntimeError: the infrastructure failed.
        """
        graded = self._grader("answer", answer)
        expected = self._grader.prepare().tests
        run = Run(graded=graded, results=self._grader.last_results(), expected=expected)
        return to_report(run, self.question, answer)


def _answer_path(language: str, file: str) -> str:
    if not file:
        raise ReferenceError("the question does not name its file")
    return f"src/{file}" if language == "elm" else file


def _write_template(question: CodeQuestion, template: Path) -> None:
    if template.exists():
        shutil.rmtree(template)
    (template / "tests").mkdir(parents=True)
    elm_json = resources.files("chalk_worker").joinpath("resources/elm.json").read_text()
    (template / "elm.json").write_text(elm_json)
    names: set[str] = set()
    for index, source in enumerate(question.tests):
        module = elm_module(source.text or "")
        if module is None:
            raise ReferenceError(f"test source {index} has no `module` header")
        if module in names:
            raise ReferenceError(f"two test sources declare module {module}")
        names.add(module)
        path = template / "tests" / (module.replace(".", "/") + ".elm")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source.text or "")
