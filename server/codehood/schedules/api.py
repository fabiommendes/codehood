from typing import Annotated

from ninja import ModelSchema
from pydantic import BeforeValidator

from ..classrooms import api as api
from ..classrooms.rules import Perms
from ..classrooms.models import Classroom
from ..types import AuthenticatedRequest as HttpRequest
from . import models

DAY_REPRS = [day.name.lower() for day in models.Day]


class Event(ModelSchema):
    class Meta:
        model = models.Event
        fields = ["title", "description", "week", "start", "end", "is_holliday"]


class TimeSlot(ModelSchema):
    class Meta:
        model = models.TimeSlot
        fields = ["start", "end", "day"]

    day: Annotated[str, BeforeValidator(DAY_REPRS.__getitem__)]


class Schedule(ModelSchema):
    class Meta:
        model = Classroom
        fields = ["start", "end"]

    time_slots: list[TimeSlot]
    events: list[Event]


@api.classrooms_router.get("/{id}/schedule", response=Schedule)
def get_schedule(request: HttpRequest, id: str):
    """
    Return all classrooms where the user is enrolled.
    """
    classroom = Classroom.objects.get(public_id=id)
    if request.user.has_perm(Perms.VIEW_CLASSROOM, classroom):
        return classroom
    raise Classroom.DoesNotExist
