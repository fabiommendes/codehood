from __future__ import annotations
import copy
from typing import Any, Sequence
from rich import print

type JSON = Any

__all__ = ["remove_keys", "expand_refs"]


def remove_keys(node: JSON, keys: Sequence[str]):
    """
    Remove (possibly deep) keys from a JSON object.
    """

    node = copy.deepcopy(node)
    _remove_keys(node, set(keys))
    return node


def _remove_keys(node: JSON, keys: set[str]):
    if isinstance(node, list):
        for item in node:
            _remove_keys(item, keys)

    if not isinstance(node, dict):
        return

    for key in keys.intersection(node.keys()):
        del node[key]

    for value in node.values():
        _remove_keys(value, keys)

    if "required" in node:
        node["required"] = [item for item in node["required"] if item not in keys]
