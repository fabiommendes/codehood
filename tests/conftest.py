from __future__ import annotations

import pytest

from codehood.models.repo import CourseIdentity, ServerConfig


@pytest.fixture
def identity() -> CourseIdentity:
    return CourseIdentity(discipline="cs101", instructor="ada", edition="2026-1")


@pytest.fixture
def server() -> ServerConfig:
    return ServerConfig(url="https://codehood.example.edu")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run tests marked 'integration' (need a live Codehood server; see CODEHOOD_SERVER)",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """
    Skip `integration`-marked tests unless `--run-integration` is given.

    Not `-m "not integration"` in `addopts`: that composes with a
    command-line `-m integration` as AND, not override, so passing
    `-m integration` to opt in would instead select nothing.
    """
    if config.getoption("--run-integration"):
        return
    skip_integration = pytest.mark.skip(
        reason="needs --run-integration and a running Codehood server"
    )
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_integration)
