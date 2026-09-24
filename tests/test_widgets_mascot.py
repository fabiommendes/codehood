"""
Tests for `Mascot` (`src/codehood_cli/widgets/mascot.py`), the small blocky
codehood mascot animated in `codehood chill`.
"""

from __future__ import annotations

import asyncio

from textual.app import App, ComposeResult

from codehood.widgets.mascot import _SEQUENCE, Mascot


class _Harness(App[None]):
    def compose(self) -> ComposeResult:
        yield Mascot(id="mascot")


def drive(body) -> None:
    """Mount a `Mascot` in a headless app and run `body(mascot)` against it."""

    async def main() -> None:
        async with _Harness().run_test() as pilot:
            await body(pilot.app.query_one("#mascot", Mascot))

    asyncio.run(main())


def _content(mascot: Mascot) -> str:
    """`Static` keeps its current content in a name-mangled private attribute."""
    return mascot._Static__content  # type: ignore[attr-defined]


def test_starts_on_first_frame() -> None:
    async def body(mascot: Mascot) -> None:
        assert _content(mascot) == _SEQUENCE[0]

    drive(body)


def test_advance_cycles_through_the_sequence_and_wraps() -> None:
    async def body(mascot: Mascot) -> None:
        for expected in (*_SEQUENCE[1:], *_SEQUENCE):
            mascot._advance()
            assert _content(mascot) == expected

    drive(body)


def test_mounting_schedules_the_animation_timer(monkeypatch) -> None:
    scheduled: list[tuple[float, object]] = []
    monkeypatch.setattr(
        Mascot,
        "set_interval",
        lambda self, interval, callback: scheduled.append((interval, callback)),
    )

    async def body(mascot: Mascot) -> None:
        pass

    drive(body)
    assert scheduled and scheduled[0][1].__func__ is Mascot._advance
