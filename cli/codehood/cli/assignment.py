"""
`codehood assignment`: look at the teams of an assignment, download their
deliveries, and adjust a team's deadline or members.

The assignments themselves are pushed from `assignments/` by `codehood push`.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, NoReturn
from urllib.parse import quote

import httpx
import typer
from pydantic import ValidationError
from rich.console import Console
from rich.table import Table
from rich.text import Text

from .. import repo
from ..api import generated
from ..api.base import auth_headers, get_client
from ..api.teams import list_teams
from ..assignments import (
    AmbiguousTeamError,
    TeamNotFoundError,
    find_team,
    git_env,
    local_time,
    parse_deadline,
    plan_folders,
    target_sha,
    team_members,
)
from ..models.repo import RepoConfig
from ..push.run import describe_failure
from ..submissions import Outcome, find_existing, sync_team
from .base import app

__all__ = ["assignment", "clone", "extend", "move", "status"]

assignment = typer.Typer(
    name="assignment", help="Look at and adjust the teams of an assignment."
)
app.add_typer(assignment)

#: What a team's size exception says in the status table.
SIZE_TEXTS = {
    "above": "above the maximum size",
    "below": "below the minimum size",
    "empty": "no members",
}

#: Where `clone` puts the deliveries, relative to the course repository.
SUBMISSIONS_DIR = "submissions"

PathArgument = Annotated[
    Path,
    typer.Argument(help="Course repository. Defaults to the current directory."),
]


@assignment.command()
def status(
    slug: Annotated[str, typer.Argument(help="Slug of the assignment.")],
    path: PathArgument = Path("."),
) -> None:
    """
    Show the teams of an assignment with their deliveries.

    A team that pushed before the deadline has a delivery on time; one that
    pushed after it, a late one. For an individual assignment each row is a
    student.
    """
    course = open_course(path)
    work = read_assignment(course, slug)
    teams = read_teams(course, slug)
    if not teams:
        typer.echo(f"{slug}: no teams yet")
        return
    individual = is_individual(work)
    typer.echo(f"{work.title} ({slug}), due {local_time(work.due_at)}")
    console = Console(width=None if sys.stdout.isatty() else 240, highlight=False)
    console.print(
        render_status(
            teams,
            individual=individual,
            checkpoints=[c.slug for c in work.checkpoints],
        )
    )


@assignment.command()
def clone(
    slug: Annotated[str, typer.Argument(help="Slug of the assignment.")],
    late: Annotated[
        bool,
        typer.Option(
            "--late",
            help="Check out the late delivery (the tip of main) when there is one.",
        ),
    ] = False,
    checkpoint: Annotated[
        str | None,
        typer.Option(
            "--checkpoint",
            help="Check out each team's commit at this checkpoint (its slug).",
        ),
    ] = None,
    dest: Annotated[
        Path | None,
        typer.Option(
            "--dest",
            help="Folder that holds <slug>/<team>/. Defaults to submissions/.",
        ),
    ] = None,
    path: PathArgument = Path("."),
) -> None:
    """
    Download each team's delivery into <dest>/<slug>/<team>/.

    Each folder is a git repository parked on the delivered commit, with no
    local branch. Run it again to bring the folders up to date: a folder
    whose tracked files you edited is left alone.

    Raises:
        typer.Exit: With code 1 when a team could not be downloaded, or when
            `--checkpoint` is combined with `--late` or names no checkpoint.
    """
    if checkpoint is not None and late:
        fail("--checkpoint and --late cannot be used together")
    course = open_course(path)
    work = read_assignment(course, slug)
    if checkpoint is not None and checkpoint not in {c.slug for c in work.checkpoints}:
        known = ", ".join(c.slug for c in work.checkpoints) or "none"
        fail(f"{slug!r} has no checkpoint {checkpoint!r} (checkpoints: {known})")
    teams = read_teams(course, slug)
    if not teams:
        typer.echo(f"{slug}: no teams yet")
        return

    root = (dest if dest is not None else path / SUBMISSIONS_DIR) / slug
    existing = find_existing(root)
    taken = [child.name for child in root.iterdir()] if root.is_dir() else []
    folders = plan_folders(teams, existing, taken, individual=is_individual(work))
    authorization = auth_headers(course.client)["Authorization"]
    secrets = [authorization.removeprefix("Bearer ").strip(), authorization]
    base = course.config.server.url.rstrip("/")

    counts: dict[str, int] = {}
    without: list[str] = []
    failures: list[str] = []
    for team in sorted(teams, key=lambda item: folders[item.public_id].casefold()):
        folder = folders[team.public_id]
        sha = target_sha(team, late=late, checkpoint=checkpoint)
        if sha is None:
            without.append(folder)
            continue
        url = (
            f"{base}/api/course/{course.discipline}/{course.course}/assignment/"
            f"{quote(slug, safe='')}/team/{quote(team.public_id, safe='')}/git"
        )
        outcome = sync_team(
            root / folder,
            url=url,
            public_id=team.public_id,
            sha=sha,
            env=git_env(os.environ, url, authorization),
            secrets=secrets,
        )
        counts[outcome.status] = counts.get(outcome.status, 0) + 1
        typer.echo(describe_outcome(folder, sha, outcome))
        if outcome.status == "failed":
            failures.append(folder)

    if without:
        what = (
            f"commit at checkpoint {checkpoint}"
            if checkpoint is not None
            else "late delivery or delivery"
            if late
            else "delivery on time"
        )
        typer.echo(f"no {what}: {', '.join(without)}")
    typer.echo(
        "summary: "
        + ", ".join(
            f"{counts.get(name, 0)} {name}"
            for name in ("cloned", "updated", "current", "dirty", "failed")
        )
        + f", {len(without)} without delivery"
    )
    if failures:
        raise typer.Exit(code=1)


@assignment.command()
def extend(
    slug: Annotated[str, typer.Argument(help="Slug of the assignment.")],
    team: Annotated[
        str, typer.Argument(help="Name of the team, or the username of a member.")
    ],
    due: Annotated[
        str,
        typer.Argument(
            help=(
                "New deadline, ISO 8601 with a time of day, e.g. "
                "'2026-12-12 18:00' or '2026-12-12T18:00:00-03:00'. "
                "A time without an offset is UTC."
            )
        ),
    ],
    path: PathArgument = Path("."),
) -> None:
    """
    Give one team its own deadline.
    """
    course = open_course(path)
    try:
        due_at = parse_deadline(due)
    except ValueError as exc:
        fail(f"{exc}")
    found = resolve_team(read_teams(course, slug), team)
    try:
        # Only `dueAt`: the generated body would also send `name: null`.
        response = course.client.patch(
            f"/api/course/{course.discipline}/{course.course}/assignment/"
            f"{quote(slug, safe='')}/team/{quote(found.public_id, safe='')}",
            json={"dueAt": due_at},
            headers=auth_headers(course.client),
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        fail(f"could not extend {found.name}: {describe_failure(exc)}")
    updated = generated.Team.model_validate(response.json())
    typer.echo(f"{updated.name}: due {local_time(updated.due_at)}")


@assignment.command()
def move(
    slug: Annotated[str, typer.Argument(help="Slug of the assignment.")],
    student: Annotated[str, typer.Argument(help="Username of the student.")],
    team: Annotated[
        str, typer.Argument(help="Name of the team, or the username of a member.")
    ],
    path: PathArgument = Path("."),
) -> None:
    """
    Put a student in a team, taking them out of the team they were in.
    """
    course = open_course(path)
    found = resolve_team(read_teams(course, slug), team)
    try:
        updated = generated.team_member_put(
            discipline=course.discipline,
            course=course.course,
            slug=slug,
            team=found.public_id,
            username=student,
            client=course.client,
        )
    except httpx.HTTPStatusError as exc:
        fail(f"could not move {student} to {found.name}: {describe_failure(exc)}")
    members = ", ".join(member.username for member in updated.members)
    typer.echo(f"{student} is now in {updated.name} ({members})")


#
# Utilities
#
@dataclass(frozen=True)
class Course:
    """
    The course a command acts on, and the client that reaches its server.
    """

    config: RepoConfig
    client: httpx.Client

    @property
    def discipline(self) -> str:
        return self.config.course.discipline

    @property
    def course(self) -> str:
        return f"{self.config.course.instructor}_{self.config.course.edition}"


def fail(message: str) -> NoReturn:
    """
    Print an error line and stop with code 1.

    Raises:
        typer.Exit: Always.
    """
    typer.echo(f"error: {message}", err=True)
    raise typer.Exit(code=1)


def open_course(path: Path) -> Course:
    """
    Read the repository's `codehood.toml` and build the client for its server.

    Raises:
        typer.Exit: With code 1 when there is no valid `codehood.toml`.
    """
    try:
        config = RepoConfig.open(repo.config_path(path))
    except (FileNotFoundError, ValidationError) as exc:
        fail(str(exc))
    return Course(config, get_client(config.server.url))


def read_assignment(course: Course, slug: str) -> generated.Assignment:
    """
    The assignment `slug`.

    Raises:
        typer.Exit: With code 1 when the course has no such assignment.
    """
    try:
        return generated.assignment_read(
            discipline=course.discipline,
            course=course.course,
            slug=slug,
            client=course.client,
        )
    except httpx.HTTPStatusError as exc:
        fail(status_text(slug, exc))


def read_teams(course: Course, slug: str) -> list[generated.TeamListed]:
    """
    Every team of the assignment `slug`.

    Raises:
        typer.Exit: With code 1 when the server refuses.
    """
    try:
        return list_teams(
            discipline=course.discipline,
            course=course.course,
            slug=slug,
            client=course.client,
        )
    except httpx.HTTPStatusError as exc:
        fail(status_text(slug, exc))


def resolve_team(teams: list[generated.TeamListed], ref: str) -> generated.TeamListed:
    """
    The team `ref` names, or an error line and exit code 1.

    Raises:
        typer.Exit: With code 1 when no team or several teams match.
    """
    try:
        return find_team(teams, ref)
    except (TeamNotFoundError, AmbiguousTeamError) as exc:
        fail(str(exc.args[0]))


def status_text(slug: str, exc: httpx.HTTPStatusError) -> str:
    """
    The error line for a refused read of an assignment.
    """
    match exc.response.status_code:
        case 404:
            return f"no assignment {slug!r} in this course"
        case 403:
            return f"not allowed to see the teams of {slug!r}: only the course's instructor can"
        case _:
            return (
                f"the server refused the request for {slug!r}: {describe_failure(exc)}"
            )


def is_individual(work: generated.Assignment) -> bool:
    """
    Whether each student is a team of one.
    """
    return work.team_min == 1 and work.team_max == 1


def render_status(
    teams: list[generated.TeamListed],
    *,
    individual: bool,
    checkpoints: Sequence[str] = (),
) -> Table:
    """
    The teams as a table: members, delivery on time, late delivery, the commit
    at each checkpoint, and a mark for an extended deadline or a team of the
    wrong size.
    """
    table = Table()
    table.add_column("Student" if individual else "Team", no_wrap=True)
    if not individual:
        table.add_column("Members")
    table.add_column("On time", no_wrap=True)
    table.add_column("Late", no_wrap=True)
    for checkpoint in checkpoints:
        table.add_column(checkpoint, no_wrap=True)
    table.add_column("Notes")
    for team in sorted(teams, key=lambda item: (item.name.casefold(), item.public_id)):
        name = team_members(team) if individual else team.name
        cells = [Text(name)]
        if not individual:
            cells.append(Text(team_members(team)))
        cells += [
            Text(delivery_text(team.delivery.on_time)),
            Text(delivery_text(team.delivery.late)),
            *(Text(checkpoint_text(team, slug)) for slug in checkpoints),
            Text(notes_text(team)),
        ]
        table.add_row(*cells)
    return table


def delivery_text(delivery: generated.Late | None) -> str:
    """
    A delivery as `sha time author`, `-` for none.
    """
    if delivery is None:
        return "-"
    author = f" {delivery.username}" if delivery.username else ""
    return f"{delivery.new_sha[:7]} {local_time(delivery.created_at)}{author}"


def checkpoint_text(team: generated.TeamListed, slug: str) -> str:
    """
    The short commit a team had at the checkpoint `slug`, empty for none.
    """
    for item in team.checkpoints:
        if item.slug == slug and item.push is not None:
            return item.push.new_sha[:7]
    return ""


def notes_text(team: generated.TeamListed) -> str:
    """
    The marks of a team: an extended deadline, a size outside the limits.
    """
    notes = []
    if team.extended:
        notes.append(f"extended to {local_time(team.due_at)}")
    if team.size_exception is not None:
        notes.append(SIZE_TEXTS[team.size_exception])
    return "; ".join(notes)


def describe_outcome(folder: str, sha: str, outcome: Outcome) -> str:
    """
    The line `clone` prints for one team.
    """
    match outcome.status:
        case "failed":
            return f"failed   {folder}: {outcome.message}"
        case "dirty":
            return f"warning  {folder} left as it is: {outcome.message}"
        case "current":
            return f"current  {folder} {sha[:7]}"
        case status:
            return f"{status:<8} {folder} {sha[:7]}"
