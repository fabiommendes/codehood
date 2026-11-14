"""
Terminal display of a running worker: its slots, the jobs it finished and
its log. The worker runs in a thread; the display reads its `Status`
a few times a second.
"""

from __future__ import annotations

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
    number of jobs processed, or None when the user aborted.
    """

    TITLE = "chalk-worker"
    CSS = """
    #summary { height: auto; padding: 0 1; background: $boost; }
    #slots { height: auto; max-height: 40%; }
    #finished { height: 1fr; }
    #log { height: 8; border-top: solid $primary-background; }
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
        self._stopping = False
        self._done: int | None = None

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
        finished.add_columns("at", "student", "question", "outcome", "score", "time")
        self.run_worker(self._run, thread=True, exit_on_error=True)
        self.set_interval(REFRESH, self.refresh_view)
        self.refresh_view()

    def _run(self) -> None:
        done = self.worker.run(once=self.once)
        self.call_from_thread(self._worker_done, done)

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
        table = self.query_one("#slots", DataTable)
        table.clear()
        now = time.monotonic()
        for index, job in enumerate(snapshot.slots, 1):
            if job is None:
                table.add_row(str(index), Text("idle", style="dim"), "", "", "", "")
                continue
            table.add_row(
                str(index),
                job.student,
                job.question,
                job.exam,
                Text(job.phase, style=PHASE_STYLE.get(job.phase, "")),
                _duration(now - job.started),
            )

    def _fill_finished(self, snapshot: Snapshot) -> None:
        last = snapshot.finished[-1] if snapshot.finished else None
        if last is self._shown_finished:
            return
        self._shown_finished = last
        table = self.query_one("#finished", DataTable)
        table.clear()
        for job in reversed(snapshot.finished[-SHOWN_FINISHED:]):
            table.add_row(
                f"{datetime.fromtimestamp(job.at):%H:%M:%S}",
                job.student,
                job.question,
                Text(job.outcome, style=_outcome_style(job.outcome)),
                job.score or "",
                f"{job.seconds:.1f}s",
            )


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
