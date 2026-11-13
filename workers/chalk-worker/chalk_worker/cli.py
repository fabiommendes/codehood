"""
Command line of the worker.
"""

from __future__ import annotations

import os
import signal
import tomllib
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

import typer
from mdq.models import CodeQuestion

from .client import WorkerClient
from .grading import QuestionGrader, question_hash
from .loop import Filters, Worker

app = typer.Typer(add_completion=False)

#: Environment variable with the key of the grading bot.
BOT_KEY_VAR = "CODEHOOD_BOT_KEY"


@app.command()
def run(
    server: Annotated[
        str | None, typer.Option(help="Codehood URL; default: [server] url of codehood.toml.")
    ] = None,
    key_file: Annotated[
        Path | None, typer.Option(help=f"File with the BOT key; default: ${BOT_KEY_VAR}.")
    ] = None,
    worker: Annotated[
        list[str] | None, typer.Option(help="Worker id to take jobs of (repeatable).")
    ] = None,
    exam: Annotated[str | None, typer.Option(help="Take only jobs of this exam (slug).")] = None,
    discipline: Annotated[
        str | None, typer.Option(help="Take only jobs of the courses of this discipline (slug).")
    ] = None,
    course: Annotated[
        str | None,
        typer.Option(
            help="Take only jobs of this course (<discipline>/<user>_<edition>); "
            "default: the course of codehood.toml, unless --discipline is given."
        ),
    ] = None,
    poll: Annotated[
        float, typer.Option(help="Seconds between claims when the queue is empty.")
    ] = 10,
    batch: Annotated[int, typer.Option(help="Jobs to claim at once.")] = 4,
    lease: Annotated[float, typer.Option(help="Seconds a claimed job is reserved.")] = 120,
    sandbox: Annotated[
        str | None, typer.Option(help="Sandbox of the runs: bwrap (default) or none.")
    ] = None,
    cache_dir: Annotated[
        Path | None, typer.Option(help="Where graders and packages are kept.")
    ] = None,
    once: Annotated[
        bool, typer.Option(help="Grade what is pending and exit instead of polling.")
    ] = False,
) -> None:
    """
    Claim grading jobs from Codehood, grade them locally and send the reports.
    """
    if exam and discipline:
        raise typer.BadParameter("use --exam or --discipline, not both")
    config = _course_config(Path.cwd())
    url = server or config.get("server", {}).get("url")
    if not url:
        raise typer.BadParameter("no server: use --server or set [server] url in codehood.toml")
    if course is None and discipline is None:
        course = _course_ref(config)
    key = _read_key(key_file)
    root = cache_dir or _default_cache()

    def make_grader(question: CodeQuestion) -> QuestionGrader:
        return QuestionGrader(question, root / question_hash(question)[:16], sandbox=sandbox)

    loop = Worker(
        WorkerClient(url, key),
        make_grader,
        workers=worker or ["elm-test"],
        batch=batch,
        poll=poll,
        lease=lease,
        filters=Filters(discipline=discipline, course=course, exam=exam),
        log=_log,
    )

    def stop(signum: int, _frame: Any) -> None:
        _log("stopping after the job in progress (again to abort)")
        loop.stop()
        signal.signal(signum, signal.SIG_DFL)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    _log(f"claiming {', '.join(worker or ['elm-test'])} jobs from {url}")
    done = loop.run(once=once)
    _log(f"{done} jobs processed")


def _course_config(start: Path) -> dict[str, Any]:
    for folder in (start, *start.parents):
        if (path := folder / "codehood.toml").is_file():
            return tomllib.loads(path.read_text())
    return {}


def _course_ref(config: dict[str, Any]) -> str | None:
    course = config.get("course", {})
    parts = [course.get(k) for k in ("discipline", "instructor", "edition")]
    if not all(parts):
        return None
    discipline, instructor, edition = parts
    return f"{discipline}/{instructor}_{edition}"


def _read_key(key_file: Path | None) -> str:
    key = key_file.read_text().strip() if key_file else os.environ.get(BOT_KEY_VAR, "").strip()
    if not key:
        raise typer.BadParameter(f"no BOT key: set {BOT_KEY_VAR} or use --key-file")
    return key


def _default_cache() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "chalk-worker"


def _log(line: str) -> None:
    typer.echo(f"{datetime.now():%H:%M:%S} {line}", err=True)


def main() -> None:
    app()
