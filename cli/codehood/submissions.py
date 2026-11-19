"""
The imperative shell that keeps one team's submission in a folder: it runs
`git` and nothing else.

A folder is a repository of its own, made by `git init` and a fetch, parked
on a detached commit: no local branch exists, so there is nothing to push or
to go stale. The `publicId` of the team lives in `git config codehood.team`,
which is how a later run finds the folder of a team that was renamed.
"""

from __future__ import annotations

import subprocess
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .assignments import redact

__all__ = [
    "TEAM_KEY",
    "Outcome",
    "find_existing",
    "sync_team",
]

#: The `git config` key that records which team a folder holds.
TEAM_KEY = "codehood.team"


@dataclass(frozen=True)
class Outcome:
    """
    What happened to one team's folder.
    """

    status: Literal["cloned", "updated", "current", "dirty", "failed"]
    message: str = ""


def find_existing(root: Path) -> dict[str, str]:
    """
    The `publicId` -> folder name of every repository directly under `root`
    that records its team.
    """
    found: dict[str, str] = {}
    if not root.is_dir():
        return found
    for child in sorted(root.iterdir()):
        if child.is_symlink() or not (child / ".git").exists():
            continue
        result = _git(child, "config", "--local", "--get", TEAM_KEY, check=False)
        public_id = result.stdout.strip()
        if result.returncode == 0 and public_id:
            found.setdefault(public_id, child.name)
    return found


def sync_team(
    folder: Path,
    *,
    url: str,
    public_id: str,
    sha: str,
    env: Mapping[str, str],
    secrets: Collection[str] = (),
) -> Outcome:
    """
    Bring `folder` to the commit `sha` of the repository at `url`.

    A missing folder is made and fetched. An existing one is left alone when
    its tracked files were edited, and fetched only when it is not at `sha`
    already. Never raises: a failure comes back as an `Outcome`, with every
    string in `secrets` scrubbed from its message.
    """
    created = not folder.exists()
    try:
        if created:
            folder.mkdir(parents=True)
            _git(folder, "init", "--quiet", env=env)
            _git(folder, "remote", "add", "origin", url, env=env)
            _git(folder, "config", "--local", TEAM_KEY, public_id, env=env)
        else:
            if _git(
                folder, "status", "--porcelain", "--untracked-files=no", env=env
            ).stdout.strip():
                return Outcome("dirty", "tracked files were edited here")
            _git(folder, "remote", "set-url", "origin", url, env=env)
            head = _git(folder, "rev-parse", "--verify", "HEAD", env=env, check=False)
            if head.returncode == 0 and head.stdout.strip() == sha:
                return Outcome("current")
        _git(folder, "fetch", "--quiet", "origin", env=env)
        _git(folder, "switch", "--quiet", "--detach", sha, env=env)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip().splitlines()
        message = detail[-1] if detail else f"git exited with {exc.returncode}"
        return Outcome("failed", redact(message, secrets))
    except OSError as exc:
        return Outcome("failed", redact(str(exc), secrets))
    return Outcome("cloned" if created else "updated")


#
# Utilities
#
def _git(
    folder: Path,
    *args: str,
    env: Mapping[str, str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(folder), *args],
        capture_output=True,
        text=True,
        check=check,
        env=dict(env) if env is not None else None,
    )
