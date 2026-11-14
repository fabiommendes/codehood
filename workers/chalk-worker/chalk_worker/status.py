"""
What the worker is doing, kept for a display that reads it from another
thread: the jobs in progress, the last jobs finished, the counters and the
log lines.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field, replace

__all__ = ["Active", "Finished", "Snapshot", "Status"]

#: Finished jobs kept for the display.
MAX_FINISHED = 500

#: Log lines kept for the display.
MAX_LINES = 2000


@dataclass(frozen=True)
class Active:
    """
    A job a slot of the worker is processing.
    """

    submission: str
    student: str = "?"
    question: str = "?"
    exam: str = "?"
    #: `starting`, `preparing` (the question), `waiting` (for another slot to
    #: prepare it), `grading` or `sending`.
    phase: str = "starting"
    started: float = field(default_factory=time.monotonic)


@dataclass(frozen=True)
class Finished:
    submission: str
    student: str
    question: str
    #: Status the server gave the result, `skipped`, `failed` or `returned`.
    outcome: str
    score: str | None
    seconds: float
    at: float = field(default_factory=time.time)


@dataclass(frozen=True)
class Snapshot:
    slots: tuple[Active | None, ...]
    finished: tuple[Finished, ...]
    graded: int
    failed: int
    skipped: int
    returned: int
    #: What the claim loop is doing, as a short sentence.
    state: str
    paused: bool
    started: float

    @property
    def busy(self) -> int:
        return sum(slot is not None for slot in self.slots)


class Status:
    """
    Thread safe record of the worker's activity.
    """

    def __init__(self, slots: int) -> None:
        self._lock = threading.Lock()
        self._slots: list[Active | None] = [None] * slots
        self._finished: deque[Finished] = deque(maxlen=MAX_FINISHED)
        self._lines: deque[tuple[int, str]] = deque(maxlen=MAX_LINES)
        self._line_count = 0
        self._counts = {"graded": 0, "failed": 0, "skipped": 0, "returned": 0}
        self._state = "starting"
        self._paused = False
        self._started = time.monotonic()

    def take_slot(self, submission: str) -> int:
        """
        Put a job in a free slot and return the slot's index.
        """
        with self._lock:
            for index, slot in enumerate(self._slots):
                if slot is None:
                    self._slots[index] = Active(submission)
                    return index
            self._slots.append(Active(submission))
            return len(self._slots) - 1

    def update(self, slot: int, **changes: str) -> None:
        with self._lock:
            current = self._slots[slot]
            if current is not None:
                self._slots[slot] = replace(current, **changes)

    def finish(self, slot: int, outcome: str, score: str | None = None) -> None:
        """
        Free a slot, recording how its job ended. `outcome` is a server
        status, or one of `failed`, `skipped`, `returned`.
        """
        with self._lock:
            job = self._slots[slot]
            self._slots[slot] = None
            if job is None:
                return
            kind = outcome if outcome in ("failed", "skipped", "returned") else "graded"
            self._counts[kind] += 1
            self._finished.append(
                Finished(
                    job.submission,
                    job.student,
                    job.question,
                    outcome,
                    score,
                    time.monotonic() - job.started,
                )
            )

    def set_state(self, state: str) -> None:
        with self._lock:
            self._state = state

    def set_paused(self, paused: bool) -> None:
        with self._lock:
            self._paused = paused

    def log(self, line: str) -> None:
        with self._lock:
            self._line_count += 1
            self._lines.append((self._line_count, line))

    def lines_after(self, seen: int) -> list[tuple[int, str]]:
        """
        The log lines numbered after `seen`, still kept.
        """
        with self._lock:
            return [(n, line) for n, line in self._lines if n > seen]

    def snapshot(self) -> Snapshot:
        with self._lock:
            return Snapshot(
                slots=tuple(self._slots),
                finished=tuple(self._finished),
                state=self._state,
                paused=self._paused,
                started=self._started,
                **self._counts,
            )
