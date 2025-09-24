import rich_click as click
from rich import print
from rich.console import Console
from trogon import tui  # type: ignore
from gettext import gettext as _
from click import Context
from rich import prompt

from codehood_cli.config import Config, PasswordLogin

console = Console()
ask = prompt.Prompt.ask


@tui(command="ui", help=_("Open the interactive terminal UI"))
@click.group()
@click.option("--url", help=_("Codehood URL"))
@click.option(
    "--login/--no-login",
    default=False,
    help=_("Asks the username and password to login"),
)
@click.pass_context
def cli(
    ctx: Context,
    url: str | None = None,
    login: bool = False,
):
    """
    CLI for the Codehood project.
    """
    ctx.ensure_object(dict)
    ctx.obj["url"] = url

    if login:
        ctx.obj["email"] = ask("[red bold] E-mail")
        ctx.obj["password"] = ask("[red bold] Password", password=True)


@cli.command()
@click.option("--path", default=1, help="Number of greetings.")
@click.pass_context
def sync(ctx: Context, path: click.Path, name: str):
    """
    Synchronize local files with the database.
    """
    print("todo")


@cli.command()
@click.option(
    "--instructor", "-i", default=False, help=_("Init files as an instructor, if set.")
)
@click.pass_context
def init(ctx: Context, instructor: bool):
    """
    Create a basic structure with local files.
    """
    obj = ctx.obj
    config = Config(
        url=obj.get("url", "https://codehood.dev"),
        auth=PasswordLogin(
            email=obj.get("email", "your@e-mail.com"),
            password=obj.get("password", "*"),
            trusted=False,
        ),
    )
    config.save_config()
    print(locals())


def main():
    """
    Main entry point for the CLI.
    """
    cli(obj={})


if __name__ == "__main__":
    main()
