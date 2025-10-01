from typing import Any

from django.db.models import Count, F, QuerySet
from django.db.models.functions import Now
from django.utils.translation import gettext as _
from ninja import Router
from ninja.pagination import paginate

from ..api import rest
from ..questions.models import Question as QuestionModel
from ..types import (
    AuthenticatedRequest as HttpRequest,
)
from ..types import (
    PaginatedView,
    Redacted,
    redacted,
)
from ..users.models import User
from . import models
from .schemas import Answer, Exam

router = Router(tags=[_("Exams")])


@router.get("/", response=list[Exam])
@paginate(pass_parameter="pagination_info")
def list_exams(request: HttpRequest, classroom: str | None = None, **kwargs):
    """
    List all disciplines.
    """
    qs = get_queryset(request)
    if classroom:
        qs = qs.filter(classroom__public_id=classroom)

    if request.user.role == User.Role.INSTRUCTOR:
        return qs

    view = PaginatedView(qs, kwargs["pagination_info"])
    view.apply_to_view(lambda x: redacted(x, overrides={"questions": []}))
    return view


@router.get("/{id}", response=Exam)
def get_exam(request: HttpRequest, id: str, **kwargs) -> models.Exam:
    """
    Show exam details.
    """
    exam = queryset_optimizations(models.Exam.objects.all()).get(**id_to_params(id))
    if request.user == exam.owner:
        return exam
    if exam.classroom is None:
        raise exam.DoesNotExist
    if not exam.classroom.students.contains(request.user):
        raise exam.DoesNotExist

    if kwargs.get("redacted", True):
        return RedactedStudentExam(exam, request.user)  # type: ignore
    return exam


@router.post("/{id}/answers")
def post_submission(request: HttpRequest, id: str, body: Answer):
    """
    Post an submission to an exam.
    """
    exam = get_exam(request, id, redacted=False)
    question = exam.questions.get(slug=body.id)
    if question.type != body.type:
        raise ValueError(f"Question type mismatch: {question.type} != {body.type}")
    exam.submit_response(request, question, body.answer)
    return body


def id_to_params(id: str) -> dict[str, str]:
    """
    Convert a public id to the parameters used to query the database.
    """
    if not id.startswith("("):
        return {"public_id": id}
    if not id.endswith(")"):
        raise ValueError(f"Invalid id: {id}")

    id = id[1:-1]
    discipline, instructor_and_edition, kind, slug = id.split(",")
    instructor, _, edition = instructor_and_edition.rpartition("_")
    kind = models.Exam.Kind(kind)

    return {
        "classroom__discipline__slug": discipline,
        "classroom__instructor__username": instructor,
        "classroom__edition": edition,
        "kind": kind,
        "slug": slug,
    }


def get_queryset(request: HttpRequest) -> QuerySet[models.Exam]:
    """
    Get the queryset for the current user.
    """
    user = request.user
    match user.role:
        # Students can have access to exams in their enrolled classrooms.
        # After that, they can only see exams that are public for that
        # classroom. That is, the exam must have started, and cannot be of
        # "private" or "archived" types.
        case User.Role.STUDENT:
            classes = user.classrooms_as_student.all() | user.classrooms_as_staff.all()
            queryset = models.Exam.objects.filter(
                start__lte=Now(),
                classroom__in=classes,
                kind__in=[
                    models.Exam.Kind.QUIZ,
                    models.Exam.Kind.EXAM,
                    models.Exam.Kind.PRACTICE,
                ],
            )

        # Instructors have access only to their own exams. Very simple
        case User.Role.INSTRUCTOR:
            queryset = models.Exam.objects.filter(owner=user)
        case _:
            queryset = models.Exam.objects.none()

    return queryset_optimizations(queryset)


def queryset_optimizations(qs: QuerySet[models.Exam]) -> QuerySet[models.Exam]:
    """
    Apply common optimizations and annotations to the queryset.
    """
    qs = qs.prefetch_related("tags")
    qs = qs.annotate(
        num_questions=Count(F("questions")),
        instructor_name=F("owner__name"),
        classroom_public_id=F("classroom__public_id"),
    )
    return qs


class RedactedStudentExam(Redacted[models.Exam]):
    def __init__(self, obj: models.Exam, user: User):
        self.user = user
        self.exam = obj
        self.num_questions = 42
        self.questions = [*map(RedactedStudentQuestion, obj.questions.all())]
        super().__init__(obj)


class RedactedStudentQuestion(Redacted[QuestionModel]):
    @property
    def choices(self):
        return self._obj.data["choices"]

    def __init__(self, obj: QuestionModel):
        self.shuffle = True
        self.comments = ""
        obj.type
        self.tags: list[str] = []
        clean_sensible_question_data(obj.data, obj.type)
        super().__init__(obj)


def clean_sensible_question_data(data: Any, type: QuestionModel.Type) -> Any:
    """
    Clean private question data before sending it to students.
    """
    T = QuestionModel.Type
    match type:
        case T.MULTIPLE_CHOICE | T.TRUE_FALSE | T.MULTIPLE_SELECTION:
            clean_choices(data["choices"])
        case _:
            from rich import print

            print(data, type)
            raise NotImplementedError


def clean_choices(choices):
    for choice in choices:
        choice.pop("feedback", None)
        choice.pop("grade", None)
        choice.pop("answer", None)


rest.add_router("/exams", router)
