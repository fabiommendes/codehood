from typing import Annotated, Literal

from ninja import Field, ModelSchema
from pydantic import field_validator

from ...users.api import User as UserSchema
from .. import models

EXCLUDED_CLASSROOM_FIELDS = [
    "created",
    "disable_enrollment_at",
    "modified",
    "public_id",
    "schedule_initialized",
    "status_changed",
    "status",
    "tagged_items",
    "tags",
]


class Discipline(ModelSchema):
    class Meta:
        model = models.Discipline
        fields = ["slug", "name"]


class ClassroomCreate(ModelSchema):
    class Meta:
        model = models.Classroom
        exclude = EXCLUDED_CLASSROOM_FIELDS + [
            "public_id",
            "created",
            "instructor",
            "students",
            "staff",
            "enrollment_code",
        ]
        read_only = ["discipline"]

    status: Literal["active", "private", "archived"] = "private"
    discipline: Discipline | str


class Classroom(ModelSchema):
    class Meta:
        model = models.Classroom
        exclude = EXCLUDED_CLASSROOM_FIELDS
        read_only = [
            "discipline",
            "edition",
            "instructor",
            "students",
            "staff",
            "created",
            "enrollment_code",
        ]

    id: Annotated[str, Field(validation_alias="public_id")]
    title: str
    discipline: Discipline
    instructor: UserSchema
    students: list[UserSchema]
    staff: list[UserSchema]
    status: Literal["active", "private", "archived"] = "private"

    @field_validator("status", mode="before")
    @classmethod
    def _validate_status(cls, v: int | str) -> Literal["active", "private", "archived"]:
        if isinstance(v, int):
            return models.Classroom.Status(v).name.lower()  # type: ignore
        return v
