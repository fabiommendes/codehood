"""
Tests for `codehood chill`, the Typer command wired in `codehood_cli.cli.chill`.
"""

from __future__ import annotations

from typer.testing import CliRunner

from codehood.cli.base import app

runner = CliRunner()


def test_help_exits_zero():
    result = runner.invoke(app, ["chill", "--help"])
    assert result.exit_code == 0
    assert "Chill" in result.output
