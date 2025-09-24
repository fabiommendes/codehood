from typing import Any
from pydantic import BaseModel


def openapi_schema_from_model(
    model: type[BaseModel], title: str = ""
) -> dict[str, Any]:
    """
    Generate OpenAPI schema from JSON schema.
    """
    title = title or model.__module__
    ref_template = "#/components/schemas/{model}"
    schema = model.model_json_schema(ref_template=ref_template)
    defs = schema.pop("$defs", {})
    defs[model.__name__] = schema

    return {
        "openapi": "3.1.1",
        "info": {
            "title": title,
            "version": "1.0.0",
        },
        "components": {
            "schemas": defs,
        },
    }
