"""
Tests for `codehood_cli.api.openapi`.
"""

from __future__ import annotations

import pytest

from codehood.api.openapi import load_openapi

SPEC = {
    "openapi": "3.0.0",
    "info": {"title": "Fixture", "version": "0.0.1"},
    "components": {
        "schemas": {
            "HealthOk": {
                "type": "object",
                "properties": {"status": {"type": "string"}},
                "required": ["status"],
            }
        }
    },
    "paths": {
        "/api/health": {
            "get": {
                "operationId": "getHealth",
                "summary": "Liveness probe",
                "responses": {
                    "200": {
                        "description": "ok",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/HealthOk"}
                            }
                        },
                    }
                },
            }
        }
    },
}


def test_operations_are_keyed_by_operation_id():
    spec = load_openapi(SPEC)
    endpoints = spec.operations()
    assert set(endpoints) == {"getHealth"}
    endpoint = endpoints["getHealth"]
    assert endpoint.method == "GET"
    assert endpoint.path == "/api/health"
    assert endpoint.operation.summary == "Liveness probe"


def test_resolve_follows_ref():
    spec = load_openapi(SPEC)
    schema = (
        spec.paths["/api/health"]["get"]
        .responses["200"]
        .content["application/json"]
        .content_schema
    )
    name, resolved = spec.resolve(schema)
    assert name == "HealthOk"
    assert resolved == SPEC["components"]["schemas"]["HealthOk"]


def test_resolve_requires_a_ref():
    spec = load_openapi(SPEC)
    with pytest.raises(KeyError):
        spec.resolve({"type": "string"})


def test_operation_security_overrides_document_default():
    spec_with_default_auth = {
        **SPEC,
        "security": [{"BearerAuth": []}],
        "paths": {
            "/api/health": {
                "get": {**SPEC["paths"]["/api/health"]["get"], "security": []},
            },
            "/api/me": {
                "get": {
                    "operationId": "getMe",
                    "responses": {"200": {"description": "ok", "content": {}}},
                }
            },
        },
    }
    spec = load_openapi(spec_with_default_auth)
    endpoints = spec.operations()
    assert spec.requires_auth(endpoints["getHealth"].operation) is False
    assert spec.requires_auth(endpoints["getMe"].operation) is True


def test_no_document_default_means_no_auth_anywhere():
    spec = load_openapi(SPEC)
    endpoint = spec.operations()["getHealth"]
    assert spec.requires_auth(endpoint.operation) is False
