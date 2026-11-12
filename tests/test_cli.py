from typer.testing import CliRunner

from chalk_worker.cli import app

runner = CliRunner()


def test_help() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "--exam" in result.output


def test_exam_and_discipline_are_exclusive() -> None:
    result = runner.invoke(app, ["--exam", "p1", "--discipline", "fup"])
    assert result.exit_code != 0


def test_engine_is_importable() -> None:
    from chalk_grader.profile_grader import resolve_profile

    assert resolve_profile("elm-test").description
