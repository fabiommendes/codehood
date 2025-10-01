from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, ClassVar

from django.core.validators import MinLengthValidator
from django.db import models
from django.db.models.functions import Now
from django.utils import timezone
from model_utils.managers import QueryManager
from model_utils.models import TimeStampedModel

from codehood import fields

from ..classrooms.models import Classroom
from ..text import gettext_lazy as _
from ..types import AuthenticatedRequest as HttpRequest
from ..types import TaggableManager
from ..users.models import User

if TYPE_CHECKING:
    from ..questions.models import Question  # noqa: F401
    from ..submissions.models import Submission  # noqa: F401


NOW = Now()


class Kind(models.TextChoices):
    QUIZ = "quiz", _("Quiz")
    EXAM = "exam", _("Exam")
    PRACTICE = "practice", _("Practice")
    ARCHIVED = "archived", _("Archived")
    DRAFT = "draft", _("Draft")

    def slug(self) -> str:
        match self:
            case self.QUIZ:
                return "quizzes"
            case self.EXAM:
                return "exams"
            case self.PRACTICE:
                return "exercises"
            case self.ARCHIVED:
                return "archived"
            case self.DRAFT:
                return "draft"
            case _:
                raise RuntimeError(f"should not happen: {self}")


PUBLIC_EXAMS = (Kind.QUIZ, Kind.EXAM, Kind.PRACTICE)


class Exam(TimeStampedModel):
    """
    Exam is simply a list of questions.
    """

    PUBLIC_ID_SIZE = 8
    Kind: ClassVar[type[Kind]] = Kind
    public_id = fields.public_id(PUBLIC_ID_SIZE)
    classroom = models.ForeignKey[Classroom | None, Classroom | None](
        to=Classroom,
        on_delete=models.CASCADE,
        related_name="exams",
        null=True,
        blank=True,
        help_text=_("Classroom this exam belongs to."),
    )
    owner = models.ForeignKey[User, User](
        to=User,
        on_delete=models.CASCADE,
        related_name="exams",
    )
    slug = models.SlugField(
        _("code"),
        help_text=_("Identification code for exam."),
    )
    title = models.CharField(
        _("title"),
        max_length=255,
        validators=[MinLengthValidator(1)],
        help_text=_("Title for the exam"),
    )
    kind = models.CharField(
        _("role"),
        max_length=8,
        choices=Kind.choices,
        default=Kind.DRAFT,
        help_text=_("What is the question set used for in the system."),
    )
    description = models.TextField(
        _("description"),
        validators=[MinLengthValidator(1)],
        help_text=_("A short description of the exam. Used in listings and search."),
    )
    preamble = models.TextField(
        _("preamble"),
        blank=True,
        help_text=_("A short preamble to be shown before all questions."),
    )
    start = models.DateTimeField[datetime, datetime](
        _("start"),
        default=timezone.now,
    )
    end = models.DateTimeField[datetime | None, datetime | None](
        _("end"),
        null=True,
        blank=True,
        help_text=_("End date for the exam. It becomes close for submissions."),
    )

    tags = TaggableManager()
    objects: models.Manager[Exam] = models.Manager()
    questions: models.Manager[Question]
    timeframed = QueryManager(
        models.Q(start__lte=NOW) & (models.Q(end__gte=NOW) | models.Q(end__isnull=True))
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["classroom", "slug", "kind"],
                name="unique_slug_per_classroom_and_kind",
            ),
        ]

    @property
    def is_public(self) -> bool:
        """
        Return True if the exam is visible to students.
        """
        return self.kind in PUBLIC_EXAMS

    @property
    def is_accepting_responses(self) -> bool:
        """
        Return True if the exam is accepting responses from students.
        """
        if self.start > (now := timezone.now()):
            return False
        return self.end is None or now < self.end

    def __str__(self) -> str:
        return self.title

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        if self.owner is None and self.classroom is not None:
            self.owner = self.classroom.instructor

    def submit_response(
        self, request: HttpRequest, question: Question, data: Any
    ) -> Submission:
        """
        Submit a response to the exam.
        """
        if not self.is_accepting_responses:
            raise RuntimeError("Exam is not accepting responses.")

        from ..submissions.models import Submission

        submission = Submission.new(request, question=question, exam=self, data=data)
        return submission
