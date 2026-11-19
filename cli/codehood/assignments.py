"""
The pure core of `codehood assignment`: which team lives in which folder,
which commit to put there, how to find a team by what a person types, and
the environment that carries the API key to git.

No network and no subprocess here; `submissions.py` runs git and
`cli/assignment.py` talks to the server.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Collection, Mapping, Sequence
from datetime import datetime

from .api import generated
from .push.assignment import parse_instant
from .push.exam import exam_scheduled_at

__all__ = [
    "AmbiguousTeamError",
    "TeamNotFoundError",
    "find_team",
    "folder_name",
    "git_env",
    "local_time",
    "parse_deadline",
    "plan_folders",
    "redact",
    "target_sha",
    "team_members",
]

#: Names a Windows folder cannot have, with or without an extension.
_RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", re.IGNORECASE)

#: What a folder name drops: path separators, the characters Windows refuses,
#: and control characters.
_FORBIDDEN = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')

#: The longest folder name, in UTF-8 bytes, well under the 255 most file
#: systems take once a suffix is added.
_MAX_BYTES = 100


class TeamNotFoundError(LookupError):
    """
    No team of the assignment has this name or this member.
    """


class AmbiguousTeamError(LookupError):
    """
    More than one team has this name, or this member.
    """


def folder_name(text: str) -> str:
    """
    A team's name as a single, safe path component.

    Separators and the characters Windows refuses become `-`, whitespace runs
    too, and leading and trailing dots, dashes and spaces go, so the result
    can never climb out of its parent. Letters of any script stay. A name
    reserved on Windows gets a `_`, and an empty one reads `team`.

    @example
        >>> folder_name("../x")
        'x'
        >>> folder_name("Time A/B")
        'Time-A-B'
    """
    text = unicodedata.normalize("NFC", text)
    text = _FORBIDDEN.sub("-", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-. ")
    text = _truncate(text).strip("-. ")
    if not text:
        return "team"
    if _RESERVED.match(text):
        return f"{text}_"
    return text


def plan_folders(
    teams: Sequence[generated.TeamListed],
    existing: Mapping[str, str],
    taken: Collection[str] = (),
    *,
    individual: bool = False,
) -> dict[str, str]:
    """
    The folder of each team, by `publicId`.

    A team that already has a folder (`existing`, `publicId` -> folder,
    found through `git config codehood.team`) keeps it, whatever its name is
    now. The others get their sanitized name, or the username of their only
    member in an `individual` assignment. When two names sanitize to the same
    text, or one is already `taken` by another folder, each of those teams
    gets the `publicId` as a suffix. Comparisons ignore case.
    """
    folders = dict(existing)
    reserved = {name.casefold() for name in (*taken, *existing.values())}
    wanted: dict[str, str] = {}
    for team in teams:
        if team.public_id not in folders:
            wanted[team.public_id] = folder_name(_label(team, individual))
    groups: dict[str, list[str]] = {}
    for public_id, name in wanted.items():
        groups.setdefault(name.casefold(), []).append(public_id)
    for key, public_ids in groups.items():
        for public_id in public_ids:
            name = wanted[public_id]
            if len(public_ids) > 1 or key in reserved:
                name = _suffixed(name, public_id, reserved)
            folders[public_id] = name
            reserved.add(name.casefold())
    return folders


def target_sha(
    team: generated.TeamListed, *, late: bool, checkpoint: str | None = None
) -> str | None:
    """
    The commit to check out: the delivery on time, or with `late` the late
    one when there is one, else the one on time. `None` without a delivery.

    With `checkpoint`, the commit the team had pushed by that checkpoint
    instead, `None` when it had none.
    """
    if checkpoint is not None:
        for item in team.checkpoints:
            if item.slug == checkpoint:
                return item.push.new_sha if item.push is not None else None
        return None
    on_time = team.delivery.on_time
    if late and team.delivery.late is not None:
        return team.delivery.late.new_sha
    return on_time.new_sha if on_time is not None else None


def find_team(teams: Sequence[generated.TeamListed], ref: str) -> generated.TeamListed:
    """
    The team a person means by `ref`: the one with that name, or when no
    name matches, the one that has a member with that username.

    Raises:
        TeamNotFoundError: No name and no username matches.
        AmbiguousTeamError: Several teams match.
    """
    by_name = [team for team in teams if team.name == ref]
    found = by_name or [
        team for team in teams if any(m.username == ref for m in team.members)
    ]
    if not found:
        raise TeamNotFoundError(f"no team is named {ref!r} or has a member {ref!r}")
    if len(found) > 1:
        names = ", ".join(f"{team.name} ({team.public_id})" for team in found)
        raise AmbiguousTeamError(f"{ref!r} matches {len(found)} teams: {names}")
    return found[0]


def parse_deadline(text: str) -> str:
    """
    A deadline as the text the server spells: ISO 8601 with a time of day.

    A time without an offset is UTC, as in exam files. A date alone is
    refused: it would read as midnight.

    Raises:
        ValueError: `text` is not an ISO 8601 date-time.
    """
    moment = parse_instant(text)
    if not isinstance(moment, datetime):
        raise ValueError(  # noqa: TRY004 - callers catch one error type
            f"{text!r} has no time of day, which would read as midnight UTC; "
            f"write it like '{text} 23:59'"
        )
    return exam_scheduled_at(moment)


def local_time(text: str) -> str:
    """
    An instant the server sent, as `YYYY-MM-DD HH:MM` in the local zone.
    """
    return datetime.fromisoformat(text).astimezone().strftime("%Y-%m-%d %H:%M")


def team_members(team: generated.TeamListed) -> str:
    """
    The usernames of a team's members, `-` for a team with none.
    """
    return ", ".join(member.username for member in team.members) or "-"


def git_env(base: Mapping[str, str], url: str, authorization: str) -> dict[str, str]:
    """
    The environment of a git process that must send `authorization` to `url`
    and never ask a person for anything.

    The header travels as `http.<url>.extraHeader` through
    `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`: it reaches no argument list, no
    config file, and no host but `url`'s. Settings already in `base` are kept.
    """
    env = {
        name: value
        for name, value in base.items()
        if name not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")
    }
    count = int(env.get("GIT_CONFIG_COUNT") or 0)
    env[f"GIT_CONFIG_KEY_{count}"] = f"http.{url.rstrip('/')}/.extraHeader"
    env[f"GIT_CONFIG_VALUE_{count}"] = f"Authorization: {authorization}"
    env["GIT_CONFIG_COUNT"] = str(count + 1)
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def redact(text: str, secrets: Collection[str]) -> str:
    """
    `text` with every secret replaced by `***`.
    """
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


#
# Utilities
#
def _label(team: generated.TeamListed, individual: bool) -> str:
    if individual and team.members:
        return team.members[0].username
    return team.name


def _truncate(text: str) -> str:
    while len(text.encode("utf-8")) > _MAX_BYTES:
        text = text[:-1]
    return text


def _suffixed(name: str, public_id: str, reserved: Collection[str]) -> str:
    suffix = folder_name(public_id)
    candidate = f"{_truncate(name)}-{suffix}"
    count = 2
    while candidate.casefold() in reserved:
        candidate = f"{_truncate(name)}-{suffix}-{count}"
        count += 1
    return candidate
