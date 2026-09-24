import typer


def require(
    flag: str,
    value: str | None,
    *,
    interactive: bool,
    prompt: str,
    default: str | None = None,
) -> str:
    """
    Resolve a required value: the flag if given, else a default, else a
    prompt when stdin is a TTY, else a non-zero exit naming the flag.

    Prompting only when interactive is what makes `init` testable without
    driving a pty -- see the spec's "Every value is a flag" section.
    """
    if value is not None:
        return value
    if default is not None:
        return default
    if interactive:
        return typer.prompt(prompt)
    typer.echo(f"error: missing required option '--{flag}'", err=True)
    raise typer.Exit(code=1)
