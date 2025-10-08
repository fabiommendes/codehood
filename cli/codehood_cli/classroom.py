from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable, Literal

from pydantic import BaseModel as Model
from pydantic import Field

CONFIG_TEMPLATE = """[classroom]
id = "{id}"
description = "{description}"
timezone = "{timezone}"
"""

SCHEDULE_TEMPLATE = """
# Schedule

    Start: {start}
    End: {end}
    Weekdays: {weekdays}
    Skip:
{skip_dates}

{ruler}
{events}
"""


def parse_classroom_slug(st: str) -> Slug:
    """
    Parse a classroom slug in the format 'discipline/edition'.
    """
    return Slug.parse(st)


class Slug(Model):
    discipline: str = Field(...)
    edition: str = Field(..., pattern=r"^\d{4}(-\d+)+$")

    @classmethod
    def parse(cls, s: str) -> Slug:
        parts = s.split("/")
        if len(parts) != 2:
            raise ValueError("Invalid slug format. Expected 'discipline/edition'.")
        return cls(discipline=parts[0], edition=parts[1])

    def __str__(self) -> str:
        return f"{self.discipline}/{self.edition}"

    def path(self, make: bool = True) -> Path:
        path = Path(self.discipline) / self.edition
        if make:
            path.mkdir(parents=True, exist_ok=True)
        return path


def config_template(description: str, id: str = "") -> str:
    """
    Create a schedule template with the given description and current timezone.
    """
    timezone = str(datetime.now().astimezone().tzinfo)
    return CONFIG_TEMPLATE.format(
        description=description,
        timezone=timezone,
        id=id,
    )


def schedule_template(
    start: date | None = None,
    end: date | None = None,
    weekdays: list[Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]]
    | None = None,
    skip_dates: dict[date, str] | None = None,
    events: dict[str, str] | None = None,
    ruler_size: int = 59,
) -> str:
    """
    Create a schedule template with the given parameters.

    Args:
        description: Description of the classroom.
        start: Start date of the schedule (YYYY-MM-DD).
        end: End date of the schedule (YYYY-MM-DD).
        weekdays: Comma-separated weekdays for classes (0=Mon, 6=Sun).
        skip_date: A date to skip (YYYY-MM
        -DD).
    """
    if start is None:
        start = datetime.now().date()
    if end is None:
        end = start + timedelta(days=365 / 2)
    if skip_dates is None:
        skip_dates = {start: "Reason to skip (e.g., holidays, special events, etc)"}
    if events is None:
        events = {"Event/class title": "Event description"}
    ruler = "-" * ruler_size

    return SCHEDULE_TEMPLATE.format(
        start=start.isoformat(),
        end=end.isoformat(),
        weekdays=", ".join(weekdays or ["Mon", "Wed", "Fri"]),
        skip_dates="\n".join(
            f"    - {date.isoformat()}: {reason}" for date, reason in skip_dates.items()
        ),
        ruler=ruler,
        events=(ruler + "\n").join(
            f"## {title}\n\n{description}" for title, description in events.items()
        ),
    )


def find_all(path: Path) -> Iterable[Slug]:
    """
    Find all classroom directories in the given path.

    Args:
        path: Path to search for classroom directories.
    """
    for discipline_dir in path.iterdir():
        if not discipline_dir.is_dir():
            continue
        for edition_dir in discipline_dir.iterdir():
            if not edition_dir.is_dir():
                continue
            if not (edition_dir / "classroom.toml").exists():
                continue
            try:
                yield Slug(discipline=discipline_dir.name, edition=edition_dir.name)
            except ValueError:
                continue
