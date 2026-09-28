"""
Tests for `codehood init`, the Typer command wired in
`codehood_cli.cli.init`. See `dev/specs/to-do/init.md`, "Proving it works".
"""

from __future__ import annotations

from typer.testing import CliRunner

from codehood.cli.base import app

runner = CliRunner()

ARGS = [
    "--discipline",
    "cs101",
    "--instructor",
    "ada",
    "--edition",
    "2026-1",
    "--server",
    "https://codehood.example.edu",
]


def test_help_exits_zero():
    result = runner.invoke(app, ["init", "--help"])
    assert result.exit_code == 0
    assert "Scaffold a course repository" in result.output


def test_non_interactive_missing_edition_exits_nonzero(tmp_path):
    args = [
        "init",
        str(tmp_path),
        "--discipline",
        "cs101",
        "--instructor",
        "ada",
        "--server",
        "https://codehood.example.edu",
    ]
    result = runner.invoke(app, args, input="")
    assert result.exit_code != 0
    assert "--edition" in result.output


def test_end_to_end_then_idempotent(tmp_path):
    args = ["init", str(tmp_path), *ARGS]

    first = runner.invoke(app, args, input="")
    assert first.exit_code == 0, first.output
    assert "created" in first.output
    assert (tmp_path / "codehood.toml").exists()
    assert (tmp_path / ".git").is_dir()

    second = runner.invoke(app, args, input="")
    assert second.exit_code == 0, second.output
    assert "created" not in second.output
    assert "exists" in second.output


def test_no_git_flag(tmp_path):
    args = ["init", str(tmp_path), "--no-git", *ARGS]
    result = runner.invoke(app, args, input="")
    assert result.exit_code == 0, result.output
    assert not (tmp_path / ".git").exists()


def test_invalid_slug_names_the_field(tmp_path):
    args = [
        "init",
        str(tmp_path),
        "--discipline",
        "CS101",
        "--instructor",
        "ada",
        "--edition",
        "2026-1",
        "--server",
        "https://codehood.example.edu",
    ]
    result = runner.invoke(app, args, input="")
    assert result.exit_code != 0
    assert "discipline" in result.output


def test_validation_error_output_is_one_line_per_field(tmp_path):
    """A rejected slug reports the field and the rule, with no Pydantic noise."""
    result = runner.invoke(
        app,
        [
            "init",
            str(tmp_path / "course"),
            "--discipline",
            "login",
            "--instructor",
            "ada",
            "--edition",
            "2026-01",
            "--server",
            "https://x.edu",
        ],
    )
    assert result.exit_code == 1
    assert "errors.pydantic.dev" not in result.output
    assert "input_value" not in result.output
    assert "error: discipline: discipline 'login' is a reserved name" in result.output
    assert "error: edition: edition '2026-01' must match" in result.output
    assert not (tmp_path / "course").exists()
