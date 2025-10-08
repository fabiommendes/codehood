from __future__ import annotations

from pydantic import BaseModel


class Model(BaseModel):
    """
    Base model class for MDQ
    """

    class Config:
        """Pydantic configuration"""

        extra = "forbid"
        # allow_mutation = False
        # frozen = True
        json_encoders = {
            set: list,
        }
