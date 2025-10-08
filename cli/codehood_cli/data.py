from __future__ import annotations

import tomllib
from datetime import date
from typing import Annotated, Literal

import tomlkit
from pydantic import BaseModel as Model
from pydantic import Field, field_validator

from codehood_cli import classroom

from .config import Config


class Profile(Model):
    user: str
    gender: str | None
    date_of_birth: date | None
    website: str | None
    mugshot: str | None
    bio: Annotated[str, Field(default="")]
    skills: Annotated[list[str], Field(default_factory=list)]
    email: Annotated[str, Field(default="")]
    name: Annotated[str, Field(default="")]


class Discipline(Model):
    slug: str
    name: str


class User(Model):
    name: str
    username: str
    role: str


class ClassroomConfig(Model):
    id: str
    description: str
    timezone: str


class Classroom(Model):
    id: str
    description: str
    discipline: str
    edition: str
    status: Literal["active", "inactive", "archived"]
    timezone: str
    start: date
    end: date
    students: list[User]
    staff: list[User]

    @classmethod
    def from_slug(
        cls, cfg: Config, slug: classroom.Slug, archived: bool = False
    ) -> Classroom:
        classroom_path = cfg.path / slug.discipline / slug.edition
        if not classroom_path.exists():
            raise FileNotFoundError(f"Classroom path {classroom_path} does not exist")
        if not (classroom_path / "classroom.toml").exists():
            raise FileNotFoundError(
                f"Classroom file {classroom_path / 'classroom.toml'} does not exist"
            )
        config_data = (classroom_path / "classroom.toml").read_text()
        data = tomllib.loads(config_data)
        classroom_config = ClassroomConfig.model_validate(data.get("classroom", {}))

        return Classroom(
            description=classroom_config.description,
            discipline=slug.discipline,
            edition=slug.edition,
            end=date.today(),
            enrollment_code="",
            id=classroom_config.id,
            staff=[],
            start=date.today(),
            status="archived" if archived else "active",
            students=[],
            timezone=classroom_config.timezone,
            title=slug.discipline,
        )

    @field_validator("discipline", mode="before")
    @classmethod
    def _trim_discipline(cls, v: str | dict) -> str:
        if isinstance(v, dict) and "slug" in v:
            return v["slug"]
        return v

    def update_config(self, cfg: Config) -> None:
        """
        Update the classroom.toml file with the current configuration.
        """
        path = cfg.path / self.discipline / self.edition / "classroom.toml"
        config_data = tomlkit.parse(path.read_text())
        config_data["classroom"]["id"] = self.id
        config_data["classroom"]["description"] = self.description
        config_data["classroom"]["timezone"] = self.timezone
        path.write_text(tomlkit.dumps(config_data))
