"""
`Mascot`: the small blocky codehood mascot, looping through a blink/hop
animation. Reusable anywhere in the TUI -- `codehood chill`
(`src/codehood_cli/cli/chill.py`) just mounts one full-screen with a caption
underneath.
"""

from __future__ import annotations

from textual.widgets import Static

__all__ = ["Mascot"]

_IDLE = """\
 ████████
██████████
██  ██  ██
 ████████ \
"""

_BLINK = """\
 ████████
██████████
██████████
 ████████ \
"""

_SQUAT = """\
██████████
██  ██  ██
 ████████ \
"""

_JUMP = """\
 ████████
██████████
██  ██  ██
██████████
 ████████ \
"""

#: Mostly idle, with an occasional blink or hop thrown in.
_SEQUENCE = (_IDLE, _IDLE, _BLINK, _IDLE, _SQUAT, _JUMP, _SQUAT, _IDLE)

#: Seconds each frame stays on screen.
_FRAME_SECONDS = 0.4


class Mascot(Static):
    """The codehood mascot. Starts animating as soon as it's mounted."""

    DEFAULT_CSS = """
    Mascot {
        width: auto;
        height: auto;
        content-align: center middle;
        text-align: center;
    }
    """

    def __init__(
        self,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(_SEQUENCE[0], name=name, id=id, classes=classes)
        self._frame = 0

    def on_mount(self) -> None:
        self.set_interval(_FRAME_SECONDS, self._advance)

    def _advance(self) -> None:
        self._frame = (self._frame + 1) % len(_SEQUENCE)
        self.update(_SEQUENCE[self._frame])
