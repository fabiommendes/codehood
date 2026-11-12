"""
Command line of the worker. The options follow the RFC "Worker de correção
do codehood (modelo pull)" in the chalk repository; the loop is not written
yet, because it needs the grading job queue of the server.
"""

from typing import Annotated

import typer

app = typer.Typer(add_completion=False)


@app.command()
def run(
    exam: Annotated[
        str | None, typer.Option(help="Take only jobs of this exam (slug).")
    ] = None,
    discipline: Annotated[
        str | None, typer.Option(help="Take only jobs of the courses of this discipline (slug).")
    ] = None,
    poll: Annotated[
        float, typer.Option(help="Seconds between claims when the queue is empty.")
    ] = 10,
    batch: Annotated[int, typer.Option(help="Jobs to claim at once.")] = 4,
    once: Annotated[
        bool, typer.Option(help="Grade what is pending and exit instead of polling.")
    ] = False,
) -> None:
    """
    Claim grading jobs from Codehood, grade them locally and send the feedback.
    """
    if exam and discipline:
        raise typer.BadParameter("use --exam or --discipline, not both")
    typer.echo("chalk-worker: not implemented yet (waits for the grading job queue).", err=True)
    raise typer.Exit(2)


def main() -> None:
    app()
