"""
The pure core that turns files under `assignments/` into `AssignmentFile`s.

One file per assignment, `assignments/<slug>.md`: YAML front matter for the
dates, team sizes, template and restrictions, the Markdown body for the
statement. Nothing here touches the network; `plan.py` diffs the result
against the server's state.

A file that does not parse yields an `InvalidAssignment` instead of raising,
so one bad file fails alone and the others still push.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import yaml
from pydantic import JsonValue

from .exam import exam_rev, exam_scheduled_at
from .repository import MAX_SLUG_LENGTH, REPOSITORIES_DIR, SLUG_RE
from .resource import title_from_filename
from .wire import Payload, assignment_payload

__all__ = [
    "ASSIGNMENTS_DIR",
    "MAX_TEAM_SIZE",
    "AssignmentFile",
    "AssignmentScan",
    "InvalidAssignment",
    "parse_instant",
    "parse_size",
    "scan_assignments",
]

#: The folder that holds one Markdown file per assignment.
ASSIGNMENTS_DIR = "assignments"

#: The largest team the server accepts.
MAX_TEAM_SIZE = 10

#: Front matter keys, at the top level and inside `team` and `restrictions`.
_KEYS = frozenset(
    {
        "title",
        "due",
        "closes",
        "opens",
        "team",
        "template",
        "restrictions",
        "checkpoints",
    }
)
_CHECKPOINT_KEYS = frozenset({"slug", "title", "at"})
_TEAM_KEYS = frozenset({"min", "max", "lock"})
_RESTRICTION_KEYS = frozenset({"maxRepoBytes", "maxFileBytes", "deny", "require"})

#: Units of a size such as `10mb`: decimal for `kb`, `mb`, `gb`; binary for `kib`...
_UNITS = {
    "b": 1,
    "kb": 1024,
    "mb": 1024**2,
    "gb": 1024**3,
}
_SIZE = re.compile(r"^\s*(\d+)\s*([a-z]*)\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class AssignmentFile:
    """
    One file under `assignments/`, parsed and validated.

    Dates are spelled the way the server spells them back (UTC, milliseconds,
    `Z`), so they compare as text.
    """

    slug: str
    path: Path
    title: str
    #: The statement: the file's body, without the front matter.
    body: str
    due_at: str
    opens_at: str | None = None
    closes_at: str | None = None
    teams_lock_at: str | None = None
    team_min: int = 1
    team_max: int = 1
    #: Slug of a repository under `repositories/`.
    template: str | None = None
    #: Only the limits the file sets, `None` when it sets none.
    restrictions: dict[str, JsonValue] | None = None
    #: Intermediate dates, as `{slug, title, at}`; empty when the file has none.
    checkpoints: tuple[dict[str, str], ...] = ()

    @property
    def rev(self) -> str:
        """
        The `rev` of the assignment's payload.
        """
        return exam_rev(assignment_payload(self))

    @property
    def payload(self) -> Payload:
        """
        The body of the assignment's `PUT`, without its `rev`.
        """
        return assignment_payload(self)


@dataclass(frozen=True)
class InvalidAssignment:
    """
    A file under `assignments/` that cannot be pushed, kept so the push fails
    and leaves what the server holds under its slug alone.

    `reason` names the field at fault.
    """

    slug: str
    path: Path
    reason: str


@dataclass(frozen=True)
class AssignmentScan:
    """
    What `scan_assignments` found: the files, and warnings about what it
    left alone.
    """

    items: tuple[AssignmentFile | InvalidAssignment, ...] = ()
    warnings: tuple[str, ...] = ()


def scan_assignments(root: Path, repositories: Collection[str]) -> AssignmentScan:
    """
    Read every `assignments/<slug>.md`, sorted by slug.

    Files with a `_` prefix and files that are not Markdown are not read, and
    neither is anything in a subfolder, which earns a warning. `repositories`
    are the slugs under `repositories/`, the only valid `template`s.
    """
    base = root / ASSIGNMENTS_DIR
    if not base.is_dir():
        return AssignmentScan()
    items: list[AssignmentFile | InvalidAssignment] = []
    warnings: list[str] = []
    for child in sorted(base.iterdir(), key=lambda entry: entry.name):
        if child.name.startswith("_"):
            continue
        if child.is_dir():
            warnings.append(
                f"{ASSIGNMENTS_DIR}/{child.name}: subfolders are not read, "
                f"keep the files directly in {ASSIGNMENTS_DIR}/"
            )
            continue
        if child.suffix != ".md" or not child.is_file():
            continue
        items.append(_read(child, repositories))
    return AssignmentScan(tuple(items), tuple(warnings))


def parse_size(value: object) -> int:
    """
    A size as a number of bytes: an integer, or text such as `"10mb"`.

    `kb`, `mb` and `gb` are powers of 1024, as in the server configuration;
    no unit means bytes.

    @example
        >>> parse_size("10mb")
        10485760

    Raises:
        ValueError: The value is not a positive size.
    """
    if isinstance(value, bool) or not isinstance(value, int | str):
        raise ValueError(  # noqa: TRY004 - one error type for every bad size
            f"expected a size such as 1048576 or '10mb', got {value!r}"
        )
    if isinstance(value, int):
        size = value
    else:
        match = _SIZE.match(value)
        unit = match.group(2).lower() if match else ""
        if match is None or (unit and unit not in _UNITS):
            raise ValueError(
                f"expected a size such as 1048576 or '10mb', got {value!r}"
            )
        size = int(match.group(1)) * _UNITS[unit or "b"]
    if size <= 0:
        raise ValueError(f"a size must be positive, got {value!r}")
    return size


#
# Utilities
#
def _read(
    path: Path, repositories: Collection[str]
) -> AssignmentFile | InvalidAssignment:
    """
    Parse one file into an `AssignmentFile`, or say what is wrong with it.
    """
    slug = path.stem

    def refuse(reason: str) -> InvalidAssignment:
        return InvalidAssignment(slug, path, reason)

    if not SLUG_RE.match(slug) or len(slug) > MAX_SLUG_LENGTH:
        return refuse(
            f"slug: {slug!r} is not a valid slug (lowercase letters, digits, "
            "'.', '_' and '-', starting with a letter or digit): rename the file"
        )
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return refuse(str(exc))
    try:
        front, body = _split(text)
    except ValueError as exc:
        return refuse(str(exc))

    errors: list[str] = []
    for key in front:
        if key not in _KEYS:
            errors.append(f"{key}: unknown field (known: {', '.join(sorted(_KEYS))})")
    team = _mapping(front, "team", _TEAM_KEYS, errors)
    restrictions = _mapping(front, "restrictions", _RESTRICTION_KEYS, errors)

    title = front.get("title")
    if title is None:
        title = title_from_filename(slug)
    elif not isinstance(title, str) or not title.strip():
        errors.append("title: must be text")
        title = slug
    due = _instant(front, "due", "due", errors, required=True, needs_time=True)
    closes = _instant(front, "closes", "closes", errors, needs_time=True)
    opens = _instant(front, "opens", "opens", errors)
    lock = _instant(team, "lock", "team.lock", errors, needs_time=True)

    team_min = _size_of(team, "min", "team.min", errors)
    team_max = _size_of(team, "max", "team.max", errors)
    minimum = team_min if team_min is not None else 1
    maximum = team_max if team_max is not None else minimum if "min" in team else 1
    if team_min is not None and team_max is not None and team_min > team_max:
        errors.append(f"team: min ({team_min}) is larger than max ({team_max})")

    if due is not None:
        if closes is not None and closes < due:
            errors.append("closes: is before due")
        if opens is not None and opens > due:
            errors.append("opens: is after due")
        if lock is not None and lock > due:
            errors.append("team.lock: is after due")

    template = front.get("template")
    if template is not None:
        if not isinstance(template, str):
            errors.append("template: must be the slug of a repository")
        elif template.startswith("_"):
            errors.append(
                f"template: {template!r} starts with '_', which a repository "
                "cannot be used with"
            )
        elif template not in repositories:
            errors.append(f"template: no folder {template!r} under {REPOSITORIES_DIR}/")

    limits = _restrictions(restrictions, errors)
    checkpoints = _checkpoints(front.get("checkpoints"), due, opens, errors)
    if errors:
        return refuse("; ".join(errors))
    assert due is not None and isinstance(title, str)
    return AssignmentFile(
        slug=slug,
        path=path,
        title=title.strip(),
        body=body,
        due_at=due,
        opens_at=opens,
        closes_at=closes,
        teams_lock_at=lock,
        team_min=minimum,
        team_max=maximum,
        template=template if isinstance(template, str) else None,
        restrictions=limits or None,
        checkpoints=checkpoints,
    )


def _split(text: str) -> tuple[dict[str, object], str]:
    """
    Split the front matter from the body.

    Raises:
        ValueError: There is no front matter, or it is not a YAML mapping.
    """
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("front matter: the file must start with a `---` block")
    for index in range(1, len(lines)):
        if lines[index].strip() != "---":
            continue
        try:
            data = yaml.safe_load("".join(lines[1:index]))
        except yaml.YAMLError as exc:
            raise ValueError(f"front matter: not valid YAML ({exc})") from exc
        if data is None:
            data = {}
        if not isinstance(data, dict):
            raise ValueError("front matter: must be a mapping")  # noqa: TRY004
        if not all(isinstance(key, str) for key in data):
            raise ValueError("front matter: every key must be text")
        return data, "".join(lines[index + 1 :]).lstrip("\n")
    raise ValueError("front matter: the `---` block is never closed")


def _mapping(
    front: Mapping[str, object], key: str, known: frozenset[str], errors: list[str]
) -> dict[str, object]:
    """
    The nested mapping at `key`, with its unknown keys reported.
    """
    value = front.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        errors.append(f"{key}: must be a mapping")
        return {}
    for name in value:
        if name not in known:
            errors.append(
                f"{key}.{name}: unknown field (known: {', '.join(sorted(known))})"
            )
    return {str(name): item for name, item in value.items()}


def _instant(
    source: Mapping[str, object],
    key: str,
    name: str,
    errors: list[str],
    *,
    required: bool = False,
    needs_time: bool = False,
) -> str | None:
    """
    A date field as the text the server spells, `None` when absent.

    A date without a time is midnight UTC, which a deadline cannot afford
    to mean silently: `needs_time` refuses it.
    """
    value = source.get(key)
    if value is None:
        if required:
            errors.append(f"{name}: is required")
        return None
    try:
        moment = parse_instant(value)
    except ValueError as exc:
        errors.append(f"{name}: {exc}")
        return None
    if needs_time and not isinstance(moment, datetime):
        errors.append(
            f"{name}: {value} has no time of day, which would read as midnight "
            f"UTC; write it like '{moment.isoformat()} 23:59'"
        )
        return None
    return exam_scheduled_at(moment)


def parse_instant(value: object) -> date | datetime:
    """
    Read a date the way an exam's `start` is read: ISO 8601, a date alone as a
    `date`, a time without offset as UTC.

    Raises:
        ValueError: The value is not an ISO 8601 date or date-time.
    """
    if isinstance(value, datetime | date):
        return value
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"expected an ISO 8601 date or date-time, got {value!r}")
    text = value.strip()
    try:
        return date.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"invalid date or date-time: {value!r}") from None


def _size_of(
    source: Mapping[str, object], key: str, name: str, errors: list[str]
) -> int | None:
    value = source.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        errors.append(f"{name}: must be a whole number")
        return None
    if not 1 <= value <= MAX_TEAM_SIZE:
        errors.append(f"{name}: {value} is not between 1 and {MAX_TEAM_SIZE}")
        return None
    return value


def _restrictions(
    source: Mapping[str, object], errors: list[str]
) -> dict[str, JsonValue]:
    """
    The limits the file sets, sizes in bytes.
    """
    limits: dict[str, JsonValue] = {}
    for key in ("maxRepoBytes", "maxFileBytes"):
        if source.get(key) is None:
            continue
        try:
            limits[key] = parse_size(source[key])
        except ValueError as exc:
            errors.append(f"restrictions.{key}: {exc}")
    for key in ("deny", "require"):
        value = source.get(key)
        if value is None:
            continue
        if not isinstance(value, list) or not all(isinstance(i, str) for i in value):
            errors.append(f"restrictions.{key}: must be a list of text")
            continue
        limits[key] = [*value]
    return limits


def _checkpoints(
    value: object, due: str | None, opens: str | None, errors: list[str]
) -> tuple[dict[str, str], ...]:
    """
    The checkpoints the file lists, each as `{slug, title, at}`, by `at` as the
    server lists them.
    """
    if value is None:
        return ()
    if not isinstance(value, list):
        errors.append("checkpoints: must be a list")
        return ()
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        where = f"checkpoints[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: must be a mapping with slug, title and at")
            continue
        for name in item:
            if name not in _CHECKPOINT_KEYS:
                errors.append(
                    f"{where}.{name}: unknown field "
                    f"(known: {', '.join(sorted(_CHECKPOINT_KEYS))})"
                )
        slug = item.get("slug")
        if slug is None:
            errors.append(f"{where}.slug: is required")
        elif not isinstance(slug, str) or not SLUG_RE.match(slug):
            errors.append(f"{where}.slug: {slug!r} is not a valid slug")
        elif slug in seen:
            errors.append(f"{where}.slug: {slug!r} is repeated")
        else:
            seen.add(slug)
        title = item.get("title")
        if title is None:
            errors.append(f"{where}.title: is required")
        elif not isinstance(title, str) or not title.strip():
            errors.append(f"{where}.title: must be text")
        at = _instant(item, "at", f"{where}.at", errors, required=True, needs_time=True)
        if at is not None and due is not None and at >= due:
            errors.append(f"{where}.at: is not before due")
        if at is not None and opens is not None and at < opens:
            errors.append(f"{where}.at: is before opens")
        if (
            at is not None
            and isinstance(slug, str)
            and isinstance(title, str)
            and title.strip()
        ):
            found.append({"slug": slug, "title": title.strip(), "at": at})
    return tuple(sorted(found, key=lambda item: item["at"]))
