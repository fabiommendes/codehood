"""
Pydantic models for `codehood.toml`, the course repository's identity file.

The file holds a course's identity (`discipline`, `instructor`, `edition`)
and the server it syncs with. It never holds a secret -- see
`dev/specs/to-do/init.md`, "`codehood.toml` is committed and holds no
secret", for why.
"""

from __future__ import annotations

from pathlib import Path

import tomlkit

from .base import Model
from .validators import DisciplineSlug, EditionSlug, InstructorUsername, ServerUrl

__all__ = [
    "CourseIdentity",
    "ServerConfig",
    "RepoConfig",
]


class CourseIdentity(Model):
    """
    The three values that name a course: `(discipline, instructor, edition)`.
    """

    discipline: DisciplineSlug
    instructor: InstructorUsername
    edition: EditionSlug


class ServerConfig(Model):
    """
    The server a course repository syncs with.
    """

    url: ServerUrl


class RepoConfig(Model):
    """
    The full contents of `codehood.toml`: course identity plus server.
    """

    course: CourseIdentity
    server: ServerConfig

    @classmethod
    def open(cls, path: Path | None = None) -> RepoConfig:
        """
        Open the codehood.toml file and return the corresponding config.

        Path can be the path to the config file or the base directory where it
        is located. Defaults to CWD.
        """
        if path is None:
            path = Path.cwd()
        if path.is_dir():
            path = path / "codehood.toml"

        if not path.exists():
            raise FileNotFoundError(f"could not find Codehood config at {path}")

        with path.open("r") as f:
            data = tomlkit.load(f)
            return RepoConfig.model_validate(data)
