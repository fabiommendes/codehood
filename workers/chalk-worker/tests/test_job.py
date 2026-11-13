import pytest
from conftest import SOLUTION, job_doc

from chalk_worker.job import JobError, parse_job


def test_parse_job() -> None:
    job = parse_job(job_doc())
    assert job.submission == "sub1"
    assert job.student == "joao"
    assert job.question.language == "elm"
    assert job.question.reference_solution == SOLUTION
    assert job.answer == SOLUTION


def test_job_with_a_question_that_is_not_code() -> None:
    doc = job_doc()
    doc["question"] = {"id": "q", "type": "essay", "stem": "s"}
    with pytest.raises(JobError):
        parse_job(doc)


def test_job_with_an_unresolved_test_source() -> None:
    doc = job_doc()
    doc["question"]["tests"] = [{"format": "elm", "origin": "Tests.elm"}]
    with pytest.raises(JobError, match="unresolved"):
        parse_job(doc)
