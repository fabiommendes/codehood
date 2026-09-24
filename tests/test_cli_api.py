"""
Tests for `codehood api`, the Typer command in `codehood.cli.api` and the
`ApiBrowser` Textual screen it launches. See `dev/specs/to-review/api.md`,
"Proving it works".
"""

from __future__ import annotations

import asyncio
import importlib

import httpx
from rich.console import Console
from textual.widgets import DataTable, Input, Static
from typer.testing import CliRunner

from codehood.api import generated as generated_module
from codehood.api.openapi import load_openapi
from codehood.cli.api import ApiBrowser, CallForm
from codehood.cli.base import app

# `codehood.cli`'s `__init__.py` rebinds the `api` attribute on the
# package to the Typer command function, shadowing the `api` submodule --
# `importlib` is what still hands back the actual module (`fetch_spec`
# lives there, not on the function).
api_module = importlib.import_module("codehood.cli.api")

runner = CliRunner()


def _detail_text(static: Static) -> str:
    """
    Plain text of what `#detail` was last given via `.update(...)`.

    `Static.render()` now returns a `RichVisual` wrapper that only
    Textual's own compositor can render -- `str()` on it gives a repr, not
    the content -- so this renders the widget's stored raw renderable
    (Text or Group, whatever `cli/api.py` passed to `.update`) through a
    plain `Console` instead.
    """
    console = Console(width=120, no_color=True, highlight=False)
    with console.capture() as capture:
        console.print(static._Static__content)  # type: ignore[attr-defined]
    return capture.get()


SPEC = {
    "openapi": "3.0.0",
    "info": {"title": "Fixture", "version": "0.0.1"},
    "components": {"schemas": {}},
    "paths": {
        "/api/health": {
            "get": {
                "operationId": "health",
                "summary": "Liveness probe",
                "responses": {"200": {"description": "ok", "content": {}}},
            }
        },
        "/api/auth/cli-login": {
            "post": {
                "operationId": "login",
                "summary": "Exchange credentials for a key",
                "responses": {"200": {"description": "ok", "content": {}}},
            }
        },
    },
}

#: A richer fixture exercising: a public no-body op (`health`), a public
#: op with a request body (`login`), a param-bearing op, and an op that
#: inherits the document's default auth requirement (`getMe`).
SPEC_WITH_CALLS = {
    "openapi": "3.0.0",
    "info": {"title": "Fixture", "version": "0.0.1"},
    "security": [{"BearerAuth": []}],
    "components": {
        "schemas": {
            "LoginRequest": {
                "type": "object",
                "properties": {
                    "login": {"type": "string"},
                    "password": {"type": "string"},
                },
                "required": ["login", "password"],
            },
            "LoginResponse": {
                "type": "object",
                "properties": {"token": {"type": "string"}},
                "required": ["token"],
            },
        }
    },
    "paths": {
        "/api/health": {
            "get": {
                "operationId": "health",
                "summary": "Liveness probe",
                "security": [],
                "parameters": [
                    {
                        "name": "verbose",
                        "in": "query",
                        "required": False,
                        "schema": {"type": "boolean"},
                    }
                ],
                "responses": {"200": {"description": "ok", "content": {}}},
            }
        },
        "/api/auth/cli-login": {
            "post": {
                "operationId": "login",
                "summary": "Exchange credentials for a key",
                "security": [],
                "requestBody": {
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/LoginRequest"}
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "ok",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/LoginResponse"}
                            }
                        },
                    }
                },
            }
        },
        "/api/me": {
            "get": {
                "operationId": "getMe",
                "summary": "Current user",
                "responses": {"200": {"description": "ok", "content": {}}},
            }
        },
    },
}


def test_help_exits_zero():
    result = runner.invoke(app, ["api", "--help"])
    assert result.exit_code == 0
    assert "Browse the REST API" in result.output


def test_missing_registered_endpoint_exits_nonzero(monkeypatch):
    # `ENDPOINTS` (in `codehood.api.generate`) now names a few dozen operation
    # ids; `SPEC` only declares two of them (`health`, `login`), so
    # `api_module`'s own `ENDPOINTS` -- bound at import time via
    # `from ..api.generate import ENDPOINTS` -- is scoped down to match the
    # fixture instead of asserting against the real, much larger set.
    monkeypatch.setattr(api_module, "ENDPOINTS", {"health", "login"})
    incomplete = {**SPEC, "paths": {"/api/health": SPEC["paths"]["/api/health"]}}
    monkeypatch.setattr(api_module, "fetch_spec", lambda server: incomplete)
    result = runner.invoke(app, ["api"])
    assert result.exit_code == 1
    assert "login" in result.output


def test_fetch_failure_exits_nonzero(monkeypatch):
    def _raise(server):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(api_module, "fetch_spec", _raise)
    result = runner.invoke(app, ["api"])
    assert result.exit_code == 1
    assert "could not fetch" in result.output


def test_browser_lists_registered_endpoints_and_shows_detail():
    spec = load_openapi(SPEC_WITH_CALLS)
    endpoints = {op_id: spec.operations()[op_id] for op_id in ("health", "login")}
    browser = ApiBrowser(endpoints, spec)

    async def scenario():
        async with browser.run_test():
            table = browser.query_one(DataTable)
            assert table.row_count == len(endpoints)
            browser.show_detail("health")
            detail = _detail_text(browser.query_one("#detail", Static))
            assert "verbose (query)" in detail

    asyncio.run(scenario())


def test_browsing_reflects_live_spec_not_cached():
    """Two independently-loaded specs render their own summary -- nothing
    module-level is cached between them."""
    spec_a = load_openapi(SPEC)
    spec_b_data = {
        **SPEC,
        "paths": {
            **SPEC["paths"],
            "/api/health": {
                "get": {
                    **SPEC["paths"]["/api/health"]["get"],
                    "summary": "Changed summary",
                },
            },
        },
    }
    spec_b = load_openapi(spec_b_data)
    browser_a = ApiBrowser(spec_a.operations(), spec_a)
    browser_b = ApiBrowser(spec_b.operations(), spec_b)

    async def scenario():
        async with browser_a.run_test():
            row_a = browser_a.query_one(DataTable).get_row("health")
        async with browser_b.run_test():
            row_b = browser_b.query_one(DataTable).get_row("health")
        assert row_a[3] == "Liveness probe"
        assert row_b[3] == "Changed summary"

    asyncio.run(scenario())


def test_call_with_no_body_and_no_auth_shows_result(monkeypatch):
    monkeypatch.setattr(
        generated_module,
        "health",
        lambda **kwargs: generated_module.HealthResponse(status="ok", database="ok"),
    )
    # `SPEC`, not `SPEC_WITH_CALLS` -- that fixture's `health` carries a
    # `verbose` query parameter (for the parameters-display test below),
    # which would open the call form instead of calling immediately.
    spec = load_openapi(SPEC)
    endpoints = {"health": spec.operations()["health"]}
    browser = ApiBrowser(endpoints, spec)

    async def scenario():
        async with browser.run_test() as pilot:
            await pilot.press("enter")
            await browser.workers.wait_for_complete()
            await pilot.pause()
            detail = _detail_text(browser.query_one("#detail", Static))
            assert "status='ok'" in detail

    asyncio.run(scenario())


def test_call_with_body_opens_form_and_submits(monkeypatch):
    calls: dict[str, object] = {}

    def _fake_login(**kwargs):
        calls.update(kwargs)
        return generated_module.LoginResponse(token="abc123")

    monkeypatch.setattr(generated_module, "login", _fake_login)
    spec = load_openapi(SPEC_WITH_CALLS)
    endpoints = {"login": spec.operations()["login"]}
    browser = ApiBrowser(endpoints, spec)

    async def scenario():
        async with browser.run_test() as pilot:
            await pilot.press("enter")
            await pilot.pause()
            assert isinstance(browser.screen, CallForm)
            browser.screen.query_one("#field-login", Input).value = "a@b.com"
            browser.screen.query_one("#field-password", Input).value = "secret"
            await pilot.click("#submit")
            await browser.workers.wait_for_complete()
            await pilot.pause()
            detail = _detail_text(browser.query_one("#detail", Static))
            assert "abc123" in detail

    asyncio.run(scenario())
    assert calls["body"] == generated_module.LoginRequest(
        login="a@b.com", password="secret"
    )
    assert "client" in calls


def test_call_requiring_auth_is_refused_without_a_request():
    spec = load_openapi(SPEC_WITH_CALLS)
    endpoints = {"getMe": spec.operations()["getMe"]}
    browser = ApiBrowser(endpoints, spec)

    async def scenario():
        async with browser.run_test() as pilot:
            # `generated` has no `get_me` at all -- if the refusal check were
            # skipped, this would blow up with an AttributeError instead of
            # showing the refusal message.
            await pilot.press("enter")
            await browser.workers.wait_for_complete()
            await pilot.pause()
            detail = _detail_text(browser.query_one("#detail", Static))
            assert "requires authentication" in detail

    asyncio.run(scenario())
