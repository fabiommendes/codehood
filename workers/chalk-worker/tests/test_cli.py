from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

from chalk_worker import cli
from chalk_worker.cli import app

runner = CliRunner()


def test_help() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "--exam" in result.output
    assert "--worker" in result.output


def test_exam_and_discipline_are_exclusive() -> None:
    result = runner.invoke(app, ["--exam", "p1", "--discipline", "fup"])
    assert result.exit_code != 0


def test_without_key_refuses(monkeypatch) -> None:
    monkeypatch.delenv(cli.BOT_KEY_VAR, raising=False)
    result = runner.invoke(app, ["--server", "http://x", "--once"])
    assert result.exit_code != 0
    assert cli.BOT_KEY_VAR in result.output


def test_course_of_codehood_toml(tmp_path: Path) -> None:
    (tmp_path / "codehood.toml").write_text(
        '[course]\ndiscipline = "cs101"\ninstructor = "ada"\nedition = "2026-1"\n'
        '[server]\nurl = "http://h"\n'
    )
    (tmp_path / "sub").mkdir()
    config = cli._course_config(tmp_path / "sub")
    assert config["server"]["url"] == "http://h"
    assert cli._course_ref(config) == "cs101/ada_2026-1"


def test_engine_is_importable() -> None:
    from chalk_grader.profile_grader import resolve_profile

    assert resolve_profile("elm-test").description


def test_cache_dir_takes_one_worker(tmp_path: Path) -> None:
    first = cli._lock_cache(tmp_path / "cache")
    try:
        with pytest.raises(typer.BadParameter, match="another chalk-worker"):
            cli._lock_cache(tmp_path / "cache")
    finally:
        first.close()
    cli._lock_cache(tmp_path / "cache").close()


def test_help_shows_jobs_and_tui() -> None:
    result = runner.invoke(app, ["--help"])
    assert "--jobs" in result.output
    assert "--tui" in result.output


def test_sizes() -> None:
    assert cli._bytes("512MiB", "--memory") == 512 * 1024**2
    assert cli._bytes("1GB", "--memory") == 10**9
    assert cli._bytes("0", "--memory") == 0
    with pytest.raises(typer.BadParameter, match="--memory"):
        cli._bytes("lots", "--memory")
