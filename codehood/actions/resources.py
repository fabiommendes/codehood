from dataclasses import dataclass
from pathlib import Path
from typing import Literal, assert_never

from ..repo.diff import AddFile, DeleteFile, Diff, FileType, UpdateFile


@dataclass(frozen=True)
class ResourceAction:
    resource_id: str
    path: Path
    method: Literal["UPLOAD", "DELETE"]

    def run(self): ...


def resource_action(diff: Diff):
    """
    For each diff operation, create the Resource action
    """
    if diff.type != FileType.RESOURCE:
        raise ValueError(f"{diff} is not a resource")

    match diff:
        case AddFile(name) | UpdateFile(name):
            return ResourceAction(name, diff.path, "UPLOAD")
        case DeleteFile(name):
            return ResourceAction(name, diff.path, "DELETE")
        case other:
            assert_never(other)
