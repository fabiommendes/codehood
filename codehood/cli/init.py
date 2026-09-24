"""
`codehood init`: scaffold a course repository.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from ..api.base import load_token, stored_servers
from ..models.repo import CourseIdentity, ServerConfig
from ..repo import RepoError, write_repo
from .base import app
from .uitils import require

__all__ = [
    "init",
]


@app.command()
def init(
    path: Annotated[
        Path,
        typer.Argument(help="Directory to initialize. Created if missing."),
    ] = Path("."),
    discipline: Annotated[
        str | None,
        typer.Option("--discipline", help="Discipline slug, e.g. 'cs101'."),
    ] = None,
    instructor: Annotated[
        str | None,
        typer.Option("--instructor", help="Instructor username, e.g. 'ada'."),
    ] = None,
    edition: Annotated[
        str | None,
        typer.Option("--edition", help="Edition, e.g. '2026-1'."),
    ] = None,
    server: Annotated[
        str | None,
        typer.Option("--server", help="Codehood server URL this course syncs with."),
    ] = None,
    name: Annotated[
        str | None,
        typer.Option(
            "--name",
            help="Course name, written as README.md's H1. Defaults to the discipline slug.",
        ),
    ] = None,
    git: Annotated[
        bool,
        typer.Option("--git/--no-git", help="Run `git init` in the new repository."),
    ] = True,
    examples: Annotated[
        bool,
        typer.Option(
            "--examples/--no-examples", help="Write the example question and exam."
        ),
    ] = True,
) -> None:
    """
    Scaffold a course repository.
    """
    interactive = sys.stdin.isatty()
    discipline = require(
        "discipline",
        discipline,
        interactive=interactive,
        prompt="Discipline slug",
    )
    instructor = require(
        "instructor",
        instructor,
        interactive=interactive,
        prompt="Instructor username",
    )
    edition = require(
        "edition",
        edition,
        interactive=interactive,
        prompt="Edition",
    )
    server = require(
        "server",
        server,
        interactive=interactive,
        prompt="Server URL",
        default=_default_server(),
    )

    try:
        course_identity = CourseIdentity(
            discipline=discipline, instructor=instructor, edition=edition
        )
        server_config = ServerConfig(url=server)
    except ValidationError as exc:
        for line in _format_errors(exc):
            typer.echo(line, err=True)
        raise typer.Exit(code=1)

    try:
        reports = write_repo(
            path,
            course_identity,
            server_config,
            name=name,
            git=git,
            examples=examples,
        )
    except RepoError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1)

    for report in reports:
        display = str(report.path)
        if (path / report.path).is_dir():
            display += "/"
        typer.echo(f"{report.status:>9}  {display}")

    if not _has_credentials(server_config.url):
        typer.echo("next: codehood login")


def _format_errors(exc: ValidationError) -> list[str]:
    """
    Render a validation failure as one `error:` line per offending field.

    Pydantic's own `str(exc)` carries a type tag, the rejected value, and a
    link to its docs. An instructor mistyping an edition slug needs the field
    name and the rule, so that is all this keeps.
    """
    lines = []
    for error in exc.errors():
        field = ".".join(str(part) for part in error["loc"]) or "value"
        message = error["msg"].removeprefix("Value error, ")
        lines.append(f"error: {field}: {message}")
    return lines


def _default_server() -> str | None:
    """
    The one server `codehood login` has stored a key for, when there's
    exactly one.

    Covers the common one-server case (see the spec's "Every value is a
    flag" section) without guessing between several when there's more than
    one, or prompting anyway when there's none.
    """
    servers = stored_servers()
    return servers[0] if len(servers) == 1 else None


def _has_credentials(server_url: str) -> bool:
    """
    Whether `codehood login` has already stored a key for `server_url`.
    """
    return load_token(server_url) is not None
