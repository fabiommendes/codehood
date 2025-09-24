from __future__ import annotations

from typing import TYPE_CHECKING, Any
from ninja.openapi import schema

from .router import normalize_path

if TYPE_CHECKING:
    from katana.core import KatanaRPC


class OpenAPISchema(schema.OpenAPISchema):
    """
    Katana OpenAPI Schema
    """

    api: KatanaRPC

    def __init__(self, api: KatanaRPC):
        super().__init__(api, "")

    def get_paths(self):
        result: dict[str, Any] = {}
        for prefix, router in self.api._routers:
            for name, operation in router._operations.items():
                if not operation.include_in_schema:
                    continue

                qualname = ".".join([i for i in (prefix, name) if i])
                qualname = normalize_path(qualname)
                operation.operation_id = qualname
                result["#" + qualname] = {"post": self.operation_details(operation)}

        return result

    def operation_parameters(self, operation):
        return []

    def request_body(self, operation) -> dict[str, Any]:
        (model,) = [m for m in operation.models if m.__ninja_param_source__ == "body"]
        content_type = "application/json"
        schema, required = self._create_schema_from_model(model, remove_level=True)
        return {
            "content": {content_type: {"schema": schema}},
            "required": required,
        }
