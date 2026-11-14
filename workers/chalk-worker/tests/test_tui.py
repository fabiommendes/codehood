"""
The terminal display, driven by Textual's pilot over a fake server.
"""

import asyncio

from test_loop import FakeGrader, FakeServer, jobs, worker
from textual.widgets import DataTable

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
