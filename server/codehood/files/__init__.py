from __future__ import annotations

import enum
import typing
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage, Storage

if typing.TYPE_CHECKING:
    from ..users.models import User

__all__ = ["FileKind", "get_user_path", "get_user_storage", "highlight_mode"]
HIGHLIGHT_MODES: dict[str, str] = {"text/x-python": "python"}
TEXT_HIGHLIGHT: dict[str, str] = {}
TEXT_X_HIGHLIGHT: dict[str, str] = {}


class FileKind(enum.StrEnum):
    """
    Describe file types.

    A 3-letter code txt | bin | dir.
    """

    TEXT = "txt"
    BINARY = "bin"
    DIRECTORY = "dir"

    @classmethod
    def from_mime_encoding(self, mime: str | None, encoding: str | None) -> FileKind:
        print(mime, encoding, self.TEXT)
        return self.TEXT


def get_user_path(user: User) -> Path:
    """
    Return the path for the storage associated with the given user.
    """
    path: Path = Path(settings.MEDIA_ROOT) / "u" / str(user.username)
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_user_storage(user: User, subdir: Path | str = "") -> Storage:
    """
    Return a Django Storage instance for handling the root filesystem
    associated with the given user.
    """
    return FileSystemStorage(
        get_user_path(user) / subdir,
        base_url=str(Path(settings.MEDIA_URL) / "u" / str(user.username) / subdir),
    )


def highlight_mode(mime: str | None) -> str | None:
    """
    Return the highlight mode for the given mimetype.
    """
    if mime is None:
        return None
    try:
        return HIGHLIGHT_MODES[mime]
    except KeyError:
        pass

    if mime.startswith("text/x-"):
        mode = mime.removeprefix("text/x-")
        return TEXT_X_HIGHLIGHT.get(mode, mode)

    if mime.startswith("text/"):
        mode = mime.removeprefix("text/")
        return TEXT_HIGHLIGHT.get(mode, mode)
    return None
