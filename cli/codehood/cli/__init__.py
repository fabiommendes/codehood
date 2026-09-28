from .api import api
from .auth import login, logout
from .base import app as _app
from .chill import chill
from .init import init
from .push import push
from .show import show

__all__ = [
    #: Main entry point
    "main",
    #: Subcommands
    "api",
    "chill",
    "init",
    "login",
    "logout",
    "push",
    "show",
]


def main():
    """
    Codehood CLI
    """
    _app()
