from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from gettext import gettext as _
from typing import Any, Literal
from tomlkit.container import Item, Container
from tomlkit import document, item, parse, dumps, table
from codehood_cli.errors import ConfigError

from logging import getLogger


REQUIRED_FIELDS = {"url"}
CODEHOOD_BASE_SERVER = "http://codehood.dev"
type Types = Literal["str", "int", "table"]
type Role = Literal["instructor", "student"]

log = getLogger("codehood")


@dataclass
class Config:
    url: str
    auth: PasswordLogin | ApiTokenAuthentication
    path: Path = Path(".")
    role: Role = "student"

    @classmethod
    def read_config(cls, path: Path) -> Config:
        """
        Read the config file and return a Config object.
        """
        with open(path / "codehood.toml", "rb") as fd:
            data = parse(fd.read())

        if extra := data.keys() - {"codehood"}:
            msg = _("Invalid sections on config file: {}").format(extra)
            raise ConfigError(msg)
        if "codehood" not in data:
            msg = _("Could not find the [codehood] section in the config file")
            raise ConfigError(msg)

        if isinstance(data["codehood"], Item):
            msg = _("The [codehood] section must be a table")
            raise ConfigError(msg)

        config: Container = data["codehood"]
        kwargs: dict[str, Any] = {}
        for required in REQUIRED_FIELDS:
            try:
                kwargs[required] = config[required]
            except KeyError:
                msg = _("Missing required field: {}".format(required))
                raise ConfigError(msg)

        return cls(path=path, **kwargs)

    def save_config(self) -> None:
        """
        Write the config file.
        """
        config_file = self.path / "codehood.toml"
        if config_file.exists():
            with open(config_file, "r") as fd:
                doc = parse(fd.read())
        else:
            doc = document()

        root: Container = doc.setdefault("codehood", table())

        root.add("url", item(self.url or CODEHOOD_BASE_SERVER))
        root.setdefault("role", self.role)
        self.auth.dump(root.get("auth", table()))

        # Save data
        with open(config_file, "w") as fd:
            config_src = dumps(doc)
            log.debug(config_src)
            fd.write(config_src)


@dataclass
class PasswordLogin:
    email: str
    password: str
    trusted: bool = False

    def dump(self, config: Container) -> None:
        config["email"] = self.email
        if self.trusted:
            config["password"] = self.password
        else:
            config["password"] = "*"


@dataclass
class ApiTokenAuthentication:
    token: str
    trusted: bool = False

    def dump(self, config: Container) -> None:
        if self.trusted:
            config["token"] = self.token
        else:
            config["token"] = "*"


def read_as(root: Item | Container, field: str, kind: Types) -> Any:
    """
    Read a field from a root object and return it as the specified kind.
    """

    if isinstance(root, Item):
        raise ValueError("root must be a table")

    data = read_item(root, field)

    match kind:
        case "str":
            return str(data)

        case _:
            raise TypeError("unknown kind")


def read_item(root: Container, field: str) -> Item:
    try:
        data = root[field]
    except TypeError:
        data = NotImplemented

    if data is not NotImplemented and isinstance(data, Item):
        return data

    msg = _("Expect a table, got: {}").format(data)
    raise ConfigError(msg)
