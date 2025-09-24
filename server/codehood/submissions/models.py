from json import JSONEncoder
from typing import Any
from django.db import models
from django.utils.translation import gettext_lazy as _
from model_utils.models import TimeStampedModel

from ..types import AuthenticatedRequest

from ..exams.models import Exam
from ..questions.models import Question
from ..users.models import User


class SubmissionEncoder(JSONEncoder):
    """
    Custom JSON encoder for Submission.
    """

    def default(self, obj: Any) -> Any:
        if isinstance(obj, set):
            return [self.encode(item) for item in obj]
        return super().default(obj)


class Submission(TimeStampedModel):
    Type = Question.Type
    exam = models.ForeignKey(
        to=Exam,
        on_delete=models.CASCADE,
        related_name="responses",
        editable=False,
    )
    question = models.ForeignKey(
        to=Question,
        on_delete=models.CASCADE,
        related_name="responses",
        editable=False,
    )
    student = models.ForeignKey(
        to=User,
        on_delete=models.CASCADE,
        related_name="responses",
        editable=False,
    )
    type = models.CharField(
        _("type"),
        choices=Type,
        max_length=20,
        editable=False,
        help_text=_("Question type for this submission"),
    )
    data = models.JSONField(
        _("data"),
        encoder=SubmissionEncoder,
        help_text=_("Data for this submission"),
    )
    hash = models.BinaryField(
        _("hash"),
        max_length=16,
        editable=False,
        help_text=_("Hash of the data for this submission"),
    )
    waiting_for_grading = models.BooleanField(
        default=True,
        editable=False,
        help_text=_(
            "True if this submission is waiting for grading. False if it has been graded or if it was removed from the grading queue for some other reason."
        ),
    )
    ip_address = models.CharField(max_length=20, blank=True, editable=False)
    recycled: bool = False
    objects: models.Manager["Submission"]

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "question", "student", "hash"],
                name="unique_submission_per_exam_and_question",
            ),
        ]
        ordering = ["-created"]
        verbose_name = _("submission")
        verbose_name_plural = _("submissions")

    @classmethod
    def new(
        cls, request: AuthenticatedRequest, exam: Exam, question: Question, data: Any
    ):
        """
        Create a new submission.
        """
        defaults = {
            "type": question.type,
            "data": data,
            "ip_address": request.META.get("REMOTE_ADDR", ""),
        }
        new, is_created = Submission.objects.get_or_create(
            defaults,
            student=request.user,
            exam=exam,
            question=question,
            hash=question.hash_answer(data),
        )
        new.recycled = not is_created
        new.save()
        return new


class Feedback(TimeStampedModel):
    submission = models.ForeignKey(
        to=Submission,
        on_delete=models.CASCADE,
        related_name="feedback",
    )
    data = models.JSONField(
        _("data"),
        help_text=_("Data for this feedback"),
    )
    awarded_points = models.FloatField(
        _("awarded points"),
        blank=True,
        null=True,
        help_text=_(
            "Points awarded for this submission either with manual or auto grading."
        ),
    )
    delay_penalty = models.FloatField(
        default=0.0,
        editable=False,
    )
    resubmission_penalty = models.FloatField(
        default=0.0,
        editable=False,
    )
    arbitrary_adjustment = models.FloatField(
        default=0.0, help_text=_("Arbitrary adjustment made by the grader")
    )
    adjustment_reason = models.TextField(
        blank=True,
        help_text=_(
            "Reason for the arbitrary adjustment. This field is not shown to students."
        ),
    )
    grader = models.ForeignKey(
        to=User,
        on_delete=models.CASCADE,
        related_name="feedbacks_given",
        null=True,
        blank=True,
        help_text=_(
            "User who graded this submission. This field is null for auto-graded questions."
        ),
    )

    def compute_final_grade(self):
        """
        Compute the final grade for this feedback.
        """
        return (
            (
                self.awarded_points
                - self.delay_penalty
                - self.resubmission_penalty
                + self.arbitrary_adjustment
            )
            if self.awarded_points is not None
            else 0.0
        )


class Graded(models.Model):
    """
    Generic grade cache for Exams, Responses and Submissions.
    """

    class For(models.IntegerChoices):
        EXAM = 1, _("Exam")
        RESPONSE = 2, _("Response")
        SUBMISSION = 3, _("Submission")

    pk = models.CompositePrimaryKey("id", "role")  # type: ignore
    id = models.IntegerField()
    role = models.PositiveSmallIntegerField(choices=For.choices)
    awarded_points = models.FloatField()
    final_grade = models.FloatField()

    def recalculate(self):
        raise NotImplementedError
