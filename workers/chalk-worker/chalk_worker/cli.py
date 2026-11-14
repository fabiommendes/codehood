"""
Command line of the worker.
"""

from __future__ import annotations

import fcntl
import os
import signal
import sys
import tomllib
from datetime import datetime
from pathlib import Path
from typing import IO, Annotated, Any

import pydantic
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
    jobs: Annotated[
        int | None, typer.Option(help="Jobs graded at once; default: the number of cores.")
    ] = None,
    batch: Annotated[
        int | None, typer.Option(help="Most jobs asked for in one claim; default: --jobs.")
    ] = None,
    lease: Annotated[float, typer.Option(help="Seconds a claimed job is reserved.")] = 120,
    memory: Annotated[
        str,
        typer.Option(
            help="Memory one job may take, as in 512MiB, or 0 for no limit. Jobs start "
            "only while the available memory holds them."
        ),
    ] = "512MiB",
    memory_reserve: Annotated[
        str, typer.Option(help="Memory left to the rest of the machine.")
    ] = "512MiB",
    sandbox: Annotated[
        str | None, typer.Option(help="Sandbox of the runs: bwrap (default) or none.")
    ] = None,
    cache_dir: Annotated[
        Path | None, typer.Option(help="Where graders and packages are kept.")
    ] = None,
    once: Annotated[
        bool, typer.Option(help="Grade what is pending and exit instead of polling.")
    ] = False,
    tui: Annotated[
        bool | None,
        typer.Option(help="Show the slots and the jobs in a terminal UI; default: on a terminal."),
    ] = None,
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
    per_job = _bytes(memory, "--memory") or None
    reserve = _bytes(memory_reserve, "--memory-reserve")
    root = cache_dir or _default_cache()
    _cache_lock = _lock_cache(root)  # held until the process exits
    jobs = jobs or os.process_cpu_count() or 1
    if tui is None:
        tui = sys.stdin.isatty() and sys.stdout.isatty()

    def make_grader(question: CodeQuestion) -> QuestionGrader:
        return QuestionGrader(
            question, root / question_hash(question)[:16], sandbox=sandbox, memory=per_job
        )

    loop = Worker(
        WorkerClient(url, key),
        make_grader,
        workers=worker or ["elm-test"],
        jobs=jobs,
        batch=batch,
        poll=poll,
        lease=lease,
        filters=Filters(discipline=discipline, course=course, exam=exam),
        log=(lambda _: None) if tui else _log,
        memory=per_job,
        reserve=reserve,
    )
    workers = ", ".join(worker or ["elm-test"])
    if tui:
        _run_tui(loop, once, f"{workers} · {jobs} slots · {url}")
        return

    def stop(signum: int, _frame: Any) -> None:
        _log("stopping after the jobs in progress (again to abort)")
        loop.stop()
        signal.signal(signum, signal.SIG_DFL)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    _log(f"claiming {workers} jobs from {url}, {jobs} at once")
    done = loop.run(once=once)
    _log(f"{done} jobs processed")


def _run_tui(loop: Worker, once: bool, subtitle: str) -> None:
    from .tui import WorkerApp

    done = WorkerApp(loop, once=once, subtitle=subtitle).run()
    if done is None:
        # Aborted with jobs in progress: their leases run out on the server.
        _log("aborted")
        sys.stderr.flush()
        os._exit(130)
    _log(f"{done} jobs processed")


def _bytes(text: str, option: str) -> int:
    try:
        return int(pydantic.TypeAdapter(pydantic.ByteSize).validate_python(text))
    except pydantic.ValidationError:
        raise typer.BadParameter(f"{option}: not a size: {text!r}") from None


def _lock_cache(root: Path) -> IO[str]:
    """
    Take the cache directory for this process, so that two workers do not
    prepare the same question in it at once.
    """
    root.mkdir(parents=True, exist_ok=True)
    lock = (root / ".lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise typer.BadParameter(
            f"another chalk-worker uses {root}; stop it, or give this one its own --cache-dir"
        ) from None
    return lock


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
