import sys
from datetime import datetime
from gettext import gettext as _
from pathlib import Path
from typing import Annotated

import requests
import rich
import typer
from rich.pretty import pprint
from rich.prompt import Prompt

from .. import api, classroom, config
from ..classroom import Slug as ClassroomSlug
from ..data import Classroom
from .add import app as add_app

BASE_PATH = Path()
CONFIG_PATH = BASE_PATH / "codehood.toml"
VALID_WEEKDAYS = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}


def parse_classroom_slug(classroom_code: str) -> ClassroomSlug:
    return ClassroomSlug.parse(classroom_code)


app = typer.Typer(
    help="CodeHood CLI",
    add_completion=False,
    pretty_exceptions_enable=False,
)
app.add_typer(add_app, name="add", help="Add resources to classroom.")


@app.command()
def init(
    server: Annotated[
        str, typer.Argument(help=_("Server URL"))
    ] = "https://codehood.dev",
    email: Annotated[
        str, typer.Option("--email", "-e", help=_("Registration e-mail"))
    ] = "",
    username: Annotated[str, typer.Option("--username", "-u", help=_("Username"))] = "",
    token: Annotated[
        str, typer.Option("--token", "-t", help=_("API token for user"))
    ] = "",
    force: Annotated[
        bool, typer.Option("--force", "-f", help=_("Overwrite existing config file"))
    ] = False,
):
    if not force and CONFIG_PATH.exists():
        typer.echo(_("Configuration file already exists."))
        raise typer.Exit(code=1)

    if not server.startswith("http"):
        server = "https://" + server

    content = config.CONFIG_TEMPLATE.format(
        server=server, email=email, token=token, username=username
    )
    CONFIG_PATH.write_text(content)
    rich.print(_("Configuration file created at [b]codehood.toml.[/b]"))


@app.command()
def login(
    fast: Annotated[
        bool, typer.Option("--fast", "-f", help=_("Skip asking password, if possible"))
    ] = False,
):
    """
    Login to CodeHood server and store authentication token.
    """
    document = config.load_document(CONFIG_PATH)
    cfg = config.load(CONFIG_PATH)
    fast = cfg.user.email != "" and fast

    # Read credentials
    if cfg.user.email == "":
        email = Prompt.ask(_("E-mail"))
    elif fast:
        email = cfg.user.email
    else:
        email = Prompt.ask(_("E-mail"), default=cfg.user.email)
    document["user"]["email"] = email

    if fast and cfg.user.token != "":
        rich.print(_("Using existing token."))
        raise typer.Exit(code=0)
    password = Prompt.ask(_("Password"), password=True)

    # Authenticate
    response = requests.post(
        cfg.server.url + "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    data = response.json()
    if data["status"] != 200:
        rich.print(f"[bold red]{data['message']}[/bold red]")
        raise typer.Exit(code=1)

    # Save authentication token
    document["user"]["token"] = data["token"]
    rich.print(_("Login successful 🎉🥳"))
    config.save_document(CONFIG_PATH, document)


@app.command()
def new(
    classroom_code: Annotated[str, typer.Argument(help=_("Classroom code"))],
    description: Annotated[
        str, typer.Option("--description", "-d", help=_("Classroom description"))
    ] = "",
    silent: Annotated[
        bool, typer.Option("--silent", "-s", help=_("Silent mode"))
    ] = False,
    start: Annotated[
        datetime | None, typer.Option("--start", help=_("Start date (YYYY-MM-DD)"))
    ] = None,
    end: Annotated[
        datetime | None, typer.Option("--end", help=_("End date (YYYY-MM-DD)"))
    ] = None,
    overwrite: Annotated[
        bool, typer.Option("--overwrite", "-f", help=_("Overwrite existing files"))
    ] = False,
    weekdays: Annotated[
        list[str] | None,
        typer.Option(
            "--weekdays",
            "-w",
            help=_("Weekdays for lessons (Mon, Tue, Wed, Thu, Fri, Sat, Sun)"),
        ),
    ] = None,
):
    """
    Create a new classroom directory template.
    """
    slug = classroom.Slug.parse(classroom_code)

    # Create directories and base configuration
    base = Path(slug.discipline)
    base.mkdir(exist_ok=True)
    path = base / slug.edition
    path.mkdir(exist_ok=True)

    # Write classroom.toml
    if overwrite or not (path / "classroom.toml").exists():
        data = classroom.config_template(description)
        (path / "classroom.toml").write_text(data)
    elif not silent:
        rich.print(f"[yellow]classroom.toml already exists in {path}[/yellow]")

    # Write schedule.md
    if overwrite or not (path / "schedule.md").exists():
        weekdays = [day.capitalize()[:3] for day in (weekdays or [])]
        if invalid := [x for x in weekdays if x not in VALID_WEEKDAYS]:
            msg = "[bold red]Invalid weekdays:[/bold red] {days}"
            days = ", ".join(invalid)
            rich.print(msg.format(days=days), file=sys.stderr)
            raise typer.Exit(code=1)

        data = classroom.schedule_template(
            start=start and start.date(),
            end=end and end.date(),
            weekdays=weekdays,
        )
        (path / "schedule.md").write_text(data)
    elif not silent:
        rich.print(f"[yellow]schedule.md already exists in {path}[/yellow]")


@app.command()
def sync(
    classroom_code: Annotated[
        str | None, typer.Argument(help=_("Classroom code"))
    ] = None,
):
    """
    Synchronize local classrooms with the server.
    """
    if classroom_code is None:
        return sync_all()
    slug = parse_classroom_slug(classroom_code)
    cfg = config.load(CONFIG_PATH)

    rich.print(_("Syncing with [b blue]{slug}[/]").format(slug=slug))

    # Check authentication
    profile = api.account.profile(cfg)
    pprint(profile)

    # Check if discipline exists
    try:
        discipline = api.disciplines.get(cfg, slug.discipline)
    except api.NotFound:
        rich.print(f"[bold red]Discipline not found:[/bold red] {slug.discipline}")
        rich.print("You might want to ask the system administrator to add it.")
        raise typer.Exit(code=1)
    pprint(discipline)

    # Sync classroom from data
    classroom = Classroom.from_slug(cfg, slug)
    pprint(classroom)

    # Check if classroom exists
    try:
        classroom_db = api.classrooms.get(cfg, slug=slug)
    except api.NotFound:
        classroom_db = api.classrooms.create(cfg, classroom)
        classroom.id = classroom_db.id
        classroom.update_config(cfg)
    pprint(classroom_db)

    # # Create classroom


def sync_all():
    for slug in classroom.find_all(BASE_PATH):
        sync(str(slug))


def main():
    app()
