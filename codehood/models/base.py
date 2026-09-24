from __future__ import annotations

from pydantic import BaseModel, ConfigDict

__all__ = [
    "Model",
]


class Model(BaseModel):
    """
    Base model for all models in the project.
    """

    model_config = ConfigDict(from_attributes=True)
