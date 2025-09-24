from typing import Annotated
from ninja import Field, ModelSchema

from ...users.api import User as UserSchema
from .. import models


class Discipline(ModelSchema):
    class Meta:
        model = models.Discipline
        fields = ["slug", "name"]


class Classroom(ModelSchema):
    class Meta:
        model = models.Classroom
        exclude = ["modified", "tags", "public_id", "status_changed", "tagged_items"]
        read_only = ["discipline", "instructor", "students", "staff"]

    id: Annotated[str, Field(validation_alias="public_id")]
    title: str
    discipline: Discipline
    instructor: UserSchema
    students: list[UserSchema]
    staff: list[UserSchema]
