from __future__ import annotations

import tomllib
from pathlib import Path
from typing import TextIO

import tomlkit
from pydantic import BaseModel as Model
from pydantic import field_validator

CONFIG_TEMPLATE = """[server]
url = "{url}"

[user]
email = "{email}"
username = "{username}"
token = "{token}"
"""


class Config(Model):
    server: Server
    user: User
    path: Path = Path()


class Server(Model):
    url: str

    @field_validator("url")
    @classmethod
    def _trim_trailing_slash(cls, v: str) -> str:
        return v.removesuffix("/")


class User(Model):
    email: str
    username: str
    token: str


def load(fp: Path | TextIO | None = None) -> Config:
    """
    Load configuration from a file or file-like object.

    Args:
        fp: Path to the configuration file or a file-like object.
    """
    if fp is None:
        fp = Path("codehood.toml")

    if hasattr(fp, "read"):
        data = tomllib.load(fp)
        value = Config.model_validate(data)

        if hasattr(fp, "name"):
            value.path = Path(fp.name).parent
        return value

    with open(fp, "rb") as fp:
        return load(fp)


def load_document(fp: Path | TextIO | None = None) -> tomlkit.TOMLDocument:
    """
    Load raw configuration and return a TOMLDocument.

    The returning data structure operates as dicts/lists and supports round trip
    editing of the config file.

    Args:
        fp: Path to the configuration file or a file-like object.
    """
    if fp is None:
        fp = Path("codehood.toml")

    if hasattr(fp, "read"):
        data = tomlkit.load(fp)
        Config.model_validate(data)  # validate
        return data
    with open(fp, "rb") as fp:
        return load_document(fp)


def save_document(fp: Path | TextIO, doc: tomlkit.TOMLDocument) -> None:
    """
    Save a TOMLDocument to a file or file-like object.

    Args:
        fp: Path to the configuration file or a file-like object.
        doc: The TOMLDocument to save.
    """
    if hasattr(fp, "write"):
        tomlkit.dump(doc, fp)
        return
    with open(fp, "w", encoding="utf-8") as fp:
        tomlkit.dump(doc, fp)
