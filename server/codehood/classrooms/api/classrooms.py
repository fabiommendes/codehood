from typing import Any, TypeVar

from django.db.models import Model, QuerySet
from django.utils.translation import gettext as _
from ninja import Router, Schema
from ninja.errors import ValidationError
from ninja.pagination import paginate

from ...types import AuthenticatedRequest as HttpRequest
from ...types import PaginatedView, redacted
from .. import models, util
from ..rules import Perms
from . import schemas

router = Router(tags=[_("Classrooms")])
T = TypeVar("T", bound=Model)


class Enroll(Schema):
    code: str


def get_queryset(request: HttpRequest) -> QuerySet[models.Classroom, models.Classroom]:
    user = request.user
    return (
        user.classrooms_as_instructor.all() | models.Classroom.active.all()
    ).distinct()


@router.get("/", response=list[schemas.Classroom])
@paginate(pass_parameter="pagination_info")
def classrooms(request: HttpRequest, discipline: str | None = None, **kwargs):
    """
    List all All classrooms.
    """
    qs = get_queryset(request)
    if discipline is not None:
        qs = qs.filter(discipline__slug=discipline)

    info = kwargs["pagination_info"]
    data = PaginatedView[Any](qs, limit=info.limit, offset=info.offset)
    for i, classroom in enumerate(data):
        if request.user.has_perm(Perms.VIEW_CLASSROOM, classroom):
            data[i] = classroom
        else:
            data[i] = public_classroom(classroom)
    return data


@router.get("/enrolled", response=list[schemas.Classroom])
def enrolled_classrooms(request: HttpRequest, discipline: str | None = None):
    """
    All classrooms in which the user is enrolled.
    """
    enrolled = request.user.classrooms_as_student.all()
    instructor = request.user.classrooms_as_instructor.all()
    staff = request.user.classrooms_as_staff.all()
    qs = (
        (enrolled | instructor | staff)
        .exclude(status=models.Classroom.Status.ARCHIVED)
        .distinct()
    )
    if discipline is not None:
        qs = qs.filter(discipline__slug=discipline)
    return qs


@router.post("/enroll", response=schemas.Classroom)
def enroll(request: HttpRequest, payload: Enroll) -> models.Classroom:
    """
    Enroll in a classroom.
    """
    try:
        classroom = models.Classroom.objects.get(enrollment_code=payload.code)
    except models.Classroom.DoesNotExist:
        raise ValidationError(
            [
                {
                    "error": "enroll-code",
                    "message": _("Invalid enrollment code"),
                }
            ]
        )
    else:
        classroom.enroll_student(request.user)
    return classroom


@router.get("/{id}", response=schemas.Classroom)
def view_classroom(request: HttpRequest, id: str):
    """
    Show basic data from a single classroom. Uses ID.
    """
    classroom = get_queryset(request).get(**util.public_id_params(id))
    if request.user.has_perm(Perms.VIEW_CLASSROOM, classroom):
        return classroom
    return public_classroom(classroom)


@router.post("/", response={201: schemas.Classroom})
def create_classroom(request: HttpRequest, classroom: schemas.ClassroomCreate):
    """
    Create a new classroom.
    """
    data = classroom.dict()
    data["instructor"] = request.user
    data["status"] = models.Classroom.Status[data["status"].upper()]
    discipline = data.pop("discipline")
    data["discipline_id" if isinstance(discipline, str) else "discipline"] = discipline
    instance = models.Classroom(**data)
    instance.save()
    return 201, schemas.Classroom.from_orm(instance)


def public_classroom(
    classroom: models.Classroom,
    overrides={"students": [], "staff": []},
) -> models.Classroom:
    """
    Returns a classroom object with only the public fields.
    """
    return redacted(classroom, overrides=overrides)
