"""
The terminal display, driven by Textual's pilot over a fake server.
"""

import asyncio
import fcntl
import json
import logging
import os
import pty
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
from pathlib import Path

import pytest
from test_loop import FakeGrader, FakeServer, jobs, worker
from textual.widgets import DataTable, Static

from chalk_worker.tui import WorkerApp


def run(coro):
    return asyncio.run(coro)


def test_shows_the_slots_and_stops_after_the_jobs_in_progress() -> None:
    server = FakeServer(jobs("a", "b", "c", "d", "e"))
    w = worker(server, FakeGrader(delay=0.4), jobs=2)
    app = WorkerApp(w)

    async def drive() -> None:
        async with app.run_test() as pilot:
            await pilot.pause(0.25)
            slots = app.query_one("#slots", DataTable)
            assert slots.row_count == 2
            assert "grading" in str(slots.get_row_at(0))
            await pilot.press("q")
            await pilot.pause(1)

    run(drive())
    assert app.return_value == 2
    assert set(server.results) == {"a", "b"}


def test_once_keeps_the_results_on_screen_until_quit() -> None:
    server = FakeServer(jobs("a", "b", "c"))
    app = WorkerApp(worker(server, FakeGrader(), jobs=2), once=True)

    async def drive() -> None:
        async with app.run_test() as pilot:
            await pilot.pause(0.5)
            assert app.query_one("#finished", DataTable).row_count == 3
            assert app.is_running
            await pilot.press("q")

    run(drive())
    assert app.return_value == 3


def test_pause_holds_the_claims() -> None:
    server = FakeServer(jobs("a"))
    w = worker(server, FakeGrader())
    w.pause()
    app = WorkerApp(w, once=True)

    async def drive() -> None:
        async with app.run_test() as pilot:
            await pilot.pause(0.2)
            assert server.claims == []
            await pilot.press("p")
            await pilot.pause(0.3)
            assert set(server.results) == {"a"}
            await pilot.press("q")

    run(drive())


def test_second_stop_aborts() -> None:
    server = FakeServer(jobs("a"))
    w = worker(server, FakeGrader(delay=1.0))
    app = WorkerApp(w)

    async def drive() -> None:
        async with app.run_test() as pilot:
            await pilot.pause(0.2)
            await pilot.press("q")
            await pilot.press("q")

    run(drive())
    assert app.return_value is None


class BlockingGrader(FakeGrader):
    """
    Grades until released, like an answer that loops until its time limit.
    """

    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def grade(self, answer: str):
        self.started.set()
        self.release.wait(5)
        return super().grade(answer)


def test_second_stop_aborts_without_waiting_for_the_jobs() -> None:
    server = FakeServer(jobs("a"))
    grader = BlockingGrader()
    app = WorkerApp(worker(server, grader))

    async def drive() -> None:
        async with app.run_test() as pilot:
            await asyncio.to_thread(grader.started.wait, 5)
            await pilot.press("q")
            await pilot.press("q")

    start = time.monotonic()
    try:
        run(drive())
        elapsed = time.monotonic() - start
    finally:
        grader.release.set()
    assert app.return_value is None
    assert elapsed < 3


def test_sigterm_stops_after_the_jobs_in_progress() -> None:
    server = FakeServer(jobs("a", "b"))
    grader = BlockingGrader()
    app = WorkerApp(worker(server, grader))

    async def drive() -> None:
        async with app.run_test() as pilot:
            await asyncio.to_thread(grader.started.wait, 5)
            os.kill(os.getpid(), signal.SIGTERM)
            await pilot.pause(0.3)
            assert app.is_running
            assert "stopping" in str(app.query_one("#summary", Static).render())
            grader.release.set()
            await pilot.pause(0.5)

    try:
        run(drive())
    finally:
        grader.release.set()
    assert app.return_value == 1
    assert set(server.results) == {"a"}
    assert signal.getsignal(signal.SIGTERM) == signal.SIG_DFL


def test_second_signal_aborts() -> None:
    grader = BlockingGrader()
    app = WorkerApp(worker(FakeServer(jobs("a")), grader))

    async def drive() -> None:
        async with app.run_test():
            await asyncio.to_thread(grader.started.wait, 5)
            os.kill(os.getpid(), signal.SIGINT)
            await asyncio.sleep(0.1)
            os.kill(os.getpid(), signal.SIGINT)
            await asyncio.sleep(0.5)

    start = time.monotonic()
    try:
        run(drive())
        elapsed = time.monotonic() - start
    finally:
        grader.release.set()
    assert app.return_value is None
    assert elapsed < 3


def test_slots_keep_their_scroll() -> None:
    server = FakeServer(jobs(*(f"s{n}" for n in range(30))))
    grader = BlockingGrader()
    w = worker(server, grader, jobs=20)
    app = WorkerApp(w)

    async def drive() -> None:
        async with app.run_test(size=(80, 24)) as pilot:
            await asyncio.to_thread(grader.started.wait, 5)
            await pilot.pause(0.3)
            slots = app.query_one("#slots", DataTable)
            assert slots.row_count == 20
            slots.scroll_y = 3
            await pilot.pause(0.6)  # a few refreshes
            scrolled = slots.scroll_y
            w.stop()
            grader.release.set()
            await pilot.pause(0.5)
            assert scrolled == 3

    try:
        run(drive())
    finally:
        w.stop()
        grader.release.set()


def finish(status, *names: str) -> None:
    for name in names:
        status.finish(status.take_slot(name), "GRADED_AUTOMATICALLY", "1")


def test_finished_keeps_its_scroll_and_puts_the_newest_first() -> None:
    w = worker(FakeServer([]), FakeGrader(), poll=60)
    app = WorkerApp(w)

    async def drive() -> None:
        async with app.run_test(size=(80, 24)) as pilot:
            w.stop()  # the jobs come from the test
            finish(w.status, *(f"s{n}" for n in range(30)))
            await pilot.pause(0.4)
            table = app.query_one("#finished", DataTable)
            assert table.row_count == 30
            assert table.get_row_at(0)[0] == 30
            table.scroll_y = 4
            await pilot.pause(0.1)
            top = table.get_row_at(table.scroll_y)[0]
            finish(w.status, "t1", "t2")
            await pilot.pause(0.4)
            assert table.get_row_at(0)[0] == 32
            assert table.get_row_at(table.scroll_y)[0] == top
            await pilot.press("q")

    try:
        run(drive())
    finally:
        w.stop()


def test_warnings_of_the_libraries_reach_the_log() -> None:
    w = worker(FakeServer([]), FakeGrader())
    app = WorkerApp(w)

    async def drive() -> None:
        async with app.run_test() as pilot:
            logging.getLogger("chalk_grader.x").warning("no cgroup\nmore detail")
            await pilot.pause(0.4)
            await pilot.press("q")

    run(drive())
    lines = [line for _, line in w.status.lines_after(0)]
    assert "warning: chalk_grader.x: no cgroup" in lines


def test_a_failing_loop_says_why() -> None:
    w = worker(FakeServer([]), FakeGrader())
    w.run = lambda once=False: 1 / 0
    app = WorkerApp(w)

    async def drive() -> None:
        async with app.run_test() as pilot:
            await pilot.pause(0.3)

    run(drive())
    assert app.return_value is None
    assert isinstance(app.error, ZeroDivisionError)


#: Runs the display of the command line over a fake server, in a terminal.
CHILD = """
import json, pathlib, sys
sys.path.insert(0, sys.argv[1])
from test_loop import FakeGrader, FakeServer, jobs, worker
from chalk_worker import cli

out = pathlib.Path(sys.argv[2])

class Grader(FakeGrader):
    def grade(self, answer):
        out.with_suffix(".started").touch()
        return super().grade(answer)

class Server(FakeServer):
    def result(self, submission, report):
        answer = super().result(submission, report)
        out.write_text(json.dumps(sorted(self.results)))
        return answer

server = Server(jobs("a", "b"))
cli._run_tui(worker(server, Grader(delay=float(sys.argv[3]))), False, "test")
"""


class Terminal:
    """
    The command line in a pseudo terminal, with what it wrote.
    """

    def __init__(self, tmp_path: Path, delay: float) -> None:
        self.out = tmp_path / "results.json"
        master, slave = pty.openpty()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        self.proc = subprocess.Popen(
            [sys.executable, "-c", CHILD, str(Path(__file__).parent), str(self.out), str(delay)],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            env=os.environ | {"TERM": "xterm-256color"},
            start_new_session=True,
        )
        os.close(slave)
        self.master = master
        self.written = b""
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        while True:
            try:
                data = os.read(self.master, 65536)
            except OSError:
                return
            if not data:
                return
            self.written += data

    def wait_grading(self) -> None:
        end = time.monotonic() + 10
        while not self.out.with_suffix(".started").exists():
            assert time.monotonic() < end, self.written[-500:]
            time.sleep(0.05)
        time.sleep(0.3)  # the display is up before the first job starts

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()
        os.close(self.master)


@pytest.fixture
def terminal(tmp_path: Path):
    terminals: list[Terminal] = []

    def start(delay: float) -> Terminal:
        terminals.append(Terminal(tmp_path, delay))
        return terminals[-1]

    yield start
    for t in terminals:
        t.close()


def test_sigterm_in_a_terminal_finishes_the_job_and_restores_the_terminal(terminal) -> None:
    t = terminal(delay=1)
    t.wait_grading()
    t.proc.send_signal(signal.SIGTERM)
    assert t.proc.wait(timeout=10) == 0
    time.sleep(0.2)
    assert json.loads(t.out.read_text()) == ["a"]
    assert b"\x1b[?1049l" in t.written
    assert b"1 jobs processed" in t.written


def test_hangup_finishes_the_job_and_leaves(terminal) -> None:
    t = terminal(delay=1)
    t.wait_grading()
    os.close(t.master)  # the terminal is gone
    t.master = os.open(os.devnull, os.O_RDONLY)
    t.proc.send_signal(signal.SIGHUP)
    assert t.proc.wait(timeout=10) == 0
    assert json.loads(t.out.read_text()) == ["a"]


def test_second_sigterm_in_a_terminal_leaves_at_once(terminal) -> None:
    t = terminal(delay=60)
    t.wait_grading()
    t.proc.send_signal(signal.SIGTERM)
    time.sleep(0.2)
    t.proc.send_signal(signal.SIGTERM)
    start = time.monotonic()
    assert t.proc.wait(timeout=10) == 130
    assert time.monotonic() - start < 1.5
    time.sleep(0.2)
    assert b"\x1b[?1049l" in t.written
    assert b"aborted" in t.written
