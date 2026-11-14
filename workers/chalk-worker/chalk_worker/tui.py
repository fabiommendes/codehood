"""
Terminal display of a running worker: its slots, the jobs it finished and
its log. The worker runs in a thread; the display reads its `Status`
a few times a second.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import threading
import time
from datetime import datetime

from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.widgets import DataTable, Footer, Header, RichLog, Static

from .loop import Worker
from .status import Finished, Snapshot

__all__ = ["WorkerApp"]

#: Seconds between refreshes of the display.
REFRESH = 0.25

#: Finished jobs shown, newest first.
SHOWN_FINISHED = 200

#: Window of the jobs-per-minute rate, in seconds.
RATE_WINDOW = 300

PHASE_STYLE = {
    "starting": "dim",
    "waiting": "yellow",
    "preparing": "magenta",
    "grading": "cyan",
    "sending": "blue",
}


class WorkerApp(App[int]):
    """
    Runs a worker and shows what it does. The result of the app is the
    number of jobs processed, or None when the user aborted or the loop
    failed; then `error` holds the loop's exception, if any.

    SIGTERM and SIGINT stop the worker as `q` does: the first one after the
    jobs in progress, the second one at once. `finished` is set once the
    loop has left, for whoever cannot wait for the app, as on a hangup.
    """

    TITLE = "chalk-worker"
    CSS = """
    #summary { height: auto; padding: 0 1; background: $boost; }
    #slots { height: auto; max-height: 40%; }
    #finished { height: 1fr; }
    #log { height: 25%; min-height: 3; border-top: solid $primary-background; }
    .label { padding: 0 1; color: $text-muted; text-style: bold; }
    """
    BINDINGS = [
        Binding("p", "toggle_pause", "Pause/resume claims"),
        Binding("q", "stop", "Stop (again to abort)"),
        Binding("ctrl+c", "stop", "Stop", show=False, priority=True),
    ]

    def __init__(self, worker: Worker, *, once: bool = False, subtitle: str = "") -> None:
        super().__init__()
        self.worker = worker
        self.once = once
        self.sub_title = subtitle
        self._seen_line = 0
        self._shown_finished: Finished | None = None
        self._finished_count = 0
        self._stopping = False
        self._done: int | None = None
        self._log_handler = _StatusHandler(worker)
        self._signals: list[signal.Signals] = []
        self._left = False
        #: The exception that ended the worker's loop, if one did.
        self.error: BaseException | None = None
        #: Set when the worker's loop has left, by a return or an exception.
        self.finished = threading.Event()

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static(id="summary")
        with Vertical():
            yield Static("Slots", classes="label")
            yield DataTable(id="slots", cursor_type="none", zebra_stripes=True)
            yield Static("Finished", classes="label")
            yield DataTable(id="finished", cursor_type="none", zebra_stripes=True)
        yield RichLog(id="log", wrap=True, markup=False)
        yield Footer()

    def on_mount(self) -> None:
        slots = self.query_one("#slots", DataTable)
        slots.add_columns("#", "student", "question", "exam", "phase", "time")
        finished = self.query_one("#finished", DataTable)
        finished.add_column("#", key="n")
        finished.add_columns("at", "student", "question", "outcome", "score", "time")
        logging.getLogger().addHandler(self._log_handler)
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(signum, self.action_stop)
            except (ValueError, RuntimeError):  # not the main thread
                continue
            self._signals.append(signum)
        # A thread of its own, not a Textual worker: those run in the
        # executor of the event loop, which the exit of the app waits for,
        # so an abort would wait for the jobs in progress.
        threading.Thread(target=self._run, name="claim-loop", daemon=True).start()
        self.set_interval(REFRESH, self.refresh_view)
        self.refresh_view()

    def on_unmount(self) -> None:
        self._left = True
        logging.getLogger().removeHandler(self._log_handler)
        loop = asyncio.get_running_loop()
        for signum in self._signals:
            loop.remove_signal_handler(signum)
        self._signals.clear()

    def _run(self) -> None:
        try:
            done = self.worker.run(once=self.once)
        except BaseException as e:  # a bug of the loop: leave, saying why
            self.finished.set()
            self._from_thread(self._worker_failed, e)
            return
        self.finished.set()
        self._from_thread(self._worker_done, done)

    def _from_thread(self, callback, *args) -> None:
        if self._left:
            return
        try:
            self.call_from_thread(callback, *args)
        except RuntimeError:  # the app has already left
            pass

    def _worker_failed(self, error: BaseException) -> None:
        self.error = error
        self.exit(None)

    def _worker_done(self, done: int) -> None:
        self._done = done
        self.refresh_view()
        if self._stopping:
            self.exit(done)
        else:
            self.notify(f"{done} jobs processed; q to quit", timeout=30)

    def action_toggle_pause(self) -> None:
        if self._stopping or self._done is not None:
            return
        if self.worker.paused:
            self.worker.resume()
            self.notify("claiming again")
        else:
            self.worker.pause()
            self.notify("no more claims; the jobs in progress go on")
        self.refresh_view()

    def action_stop(self) -> None:
        if self._done is not None:
            self.exit(self._done)
        elif self._stopping:
            self.exit(None)
        else:
            self._stopping = True
            self.worker.stop()
            self.notify("stopping after the jobs in progress (q again to abort)")
            self.refresh_view()

    def refresh_view(self) -> None:
        snapshot = self.worker.status.snapshot()
        self.query_one("#summary", Static).update(self._summary(snapshot))
        self._fill_slots(snapshot)
        self._fill_finished(snapshot)
        log = self.query_one("#log", RichLog)
        for number, line in self.worker.status.lines_after(self._seen_line):
            log.write(f"{datetime.now():%H:%M:%S} {line}")
            self._seen_line = number

    def _summary(self, snapshot: Snapshot) -> Text:
        if self._done is not None:
            state, style = "done", "bold green"
        elif self._stopping:
            state, style = "stopping", "bold yellow"
        elif snapshot.paused:
            state, style = "paused", "bold yellow"
        else:
            state, style = "running", "bold green"
        text = Text()
        text.append(f" {state} ", style=f"reverse {style}")
        text.append(f"  slots {snapshot.busy}/{len(snapshot.slots)}")
        text.append("  graded ")
        text.append(str(snapshot.graded), style="green")
        text.append("  failed ")
        text.append(str(snapshot.failed), style="red" if snapshot.failed else "")
        text.append(f"  skipped {snapshot.skipped}  returned {snapshot.returned}")
        text.append(f"  {_rate(snapshot):.1f}/min", style="bold")
        text.append(f"  up {_duration(time.monotonic() - snapshot.started)}")
        text.append(f"  · {snapshot.state}", style="dim")
        return text

    def _fill_slots(self, snapshot: Snapshot) -> None:
        # Updated in place: clearing the table would scroll it back to the top.
        table = self.query_one("#slots", DataTable)
        now = time.monotonic()
        columns = list(table.columns)
        for index, job in enumerate(snapshot.slots):
            if job is None:
                cells = [str(index + 1), Text("idle", style="dim"), "", "", "", ""]
            else:
                cells = [
                    str(index + 1),
                    job.student,
                    job.question,
                    job.exam,
                    Text(job.phase, style=PHASE_STYLE.get(job.phase, "")),
                    _duration(now - job.started),
                ]
            key = str(index)
            if index >= table.row_count:
                table.add_row(*cells, key=key)
                continue
            for column, cell in zip(columns, cells, strict=True):
                if table.get_cell(key, column) != cell:
                    table.update_cell(key, column, cell, update_width=True)

    def _fill_finished(self, snapshot: Snapshot) -> None:
        last = snapshot.finished[-1] if snapshot.finished else None
        if last is self._shown_finished:
            return
        new = _after(snapshot.finished, self._shown_finished)
        self._shown_finished = last
        table = self.query_one("#finished", DataTable)
        before = self._finished_count
        self._finished_count += len(new)
        oldest = self._finished_count - SHOWN_FINISHED
        for n, job in enumerate(new, before + 1):
            if n <= oldest:
                continue
            table.add_row(
                n,
                f"{datetime.fromtimestamp(job.at):%H:%M:%S}",
                job.student,
                job.question,
                Text(job.outcome, style=_outcome_style(job.outcome)),
                job.score or "",
                f"{job.seconds:.1f}s",
                key=str(n),
            )
        for n in range(max(1, before - SHOWN_FINISHED + 1), oldest + 1):
            if str(n) in table.rows:
                table.remove_row(str(n))
        # Newest first; a sort keeps the scroll, unlike a clear.
        table.sort("n", reverse=True)
        if table.scroll_y > 0:
            # Keep the rows in view where they were, below the new ones.
            added = min(len(new), SHOWN_FINISHED)
            self.call_after_refresh(table.scroll_relative, y=added, animate=False)


class _StatusHandler(logging.Handler):
    """
    Sends the warnings of the libraries, such as chalk-grader, to the log of
    the display, which would otherwise hide them.
    """

    def __init__(self, worker: Worker) -> None:
        super().__init__(logging.WARNING)
        self.worker = worker

    def emit(self, record: logging.LogRecord) -> None:
        try:
            lines = record.getMessage().splitlines()
            first = lines[0] if lines else ""
            self.worker.status.log(f"{record.levelname.lower()}: {record.name}: {first}")
        except Exception:
            self.handleError(record)


def _after(finished: tuple[Finished, ...], last: Finished | None) -> tuple[Finished, ...]:
    """
    The jobs of `finished` after `last`, or all of them when `last` is not
    there any longer.
    """
    for index in range(len(finished) - 1, -1, -1):
        if finished[index] is last:
            return finished[index + 1 :]
    return finished


def _outcome_style(outcome: str) -> str:
    match outcome:
        case "failed":
            return "bold red"
        case "skipped" | "returned":
            return "yellow"
        case _:
            return "green"


def _rate(snapshot: Snapshot) -> float:
    """
    Jobs finished per minute, over the last few minutes.
    """
    window = min(RATE_WINDOW, max(time.monotonic() - snapshot.started, 60))
    since = time.time() - window
    recent = sum(1 for job in snapshot.finished if job.at >= since and job.outcome != "returned")
    return recent * 60 / window


def _duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m{seconds % 60:02d}s"
    return f"{seconds // 3600}h{seconds // 60 % 60:02d}m"
