"""
A grading job as the server hands it to the worker (`POST
/api/grading-jobs/claim`).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import pydantic
from mdq.models import CodeQuestion

__all__ = ["Job", "JobError", "parse_job"]


class JobError(ValueError):
    """
    The server sent a job the worker cannot grade.
    """


@dataclass(frozen=True)
class Job:
    #: `publicId` of the submission; it also addresses the job.
    submission: str
    #: `SUBMIT` or `FINAL`.
    kind: str
    worker: str
    question: CodeQuestion
    exam: str
    course: str
    student: str
    #: The content of the submitted file.
    answer: str


def parse_job(data: Mapping[str, Any]) -> Job:
    """
    The job of a claim response.

    Raises:
        JobError: the job lacks a field, the question is not a valid `code`
            question, or one of its test sources is unresolved.
    """
    try:
        question = data["question"]
        if not isinstance(question, Mapping) or question.get("type") != "code":
            raise JobError("the question of the job is not a `code` question")
        parsed = CodeQuestion.model_validate(question)
        if not parsed.resolved:
            raise JobError("the question has an unresolved test source")
        answer = data["answer"]
        if not isinstance(answer, str):
            raise JobError("the answer of the job is not a string")
        return Job(
            submission=str(data["submission"]),
            kind=str(data["kind"]),
            worker=str(data["worker"]),
            question=parsed,
            exam=str(data["exam"]),
            course=str(data["course"]),
            student=str(data["student"]),
            answer=answer,
        )
    except KeyError as e:
        raise JobError(f"the job has no {e.args[0]!r}") from None
    except pydantic.ValidationError as e:
        raise JobError(f"invalid question: {e}") from None
