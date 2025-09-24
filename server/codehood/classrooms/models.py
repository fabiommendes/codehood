from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Self
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import models
from django.forms import ValidationError
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from model_utils.models import TimeStampedModel
from taggit.managers import TaggableManager

from .. import fields
from ..models import LoggingModel, StatusModel
from ..users.models import User
from . import util, validators

if TYPE_CHECKING:
    from ..schedules.models import Event, TimeSlot


class Discipline(models.Model):
    """
    An academic discipline.
    """

    slug = models.SlugField(
        _("code"),
        primary_key=True,
        auto_created=False,
        max_length=32,
        min_length=2,
        help_text=_("Unique identifier used to construct urls"),
        validators=[validators.discipline_slug],
    )
    name = models.CharField(
        _("name"),
        max_length=64,
        help_text=_("The full name of the academic discipline"),
    )
    objects: models.Manager[Discipline]

    class Meta:
        ordering = ["slug"]

    def __str__(self):
        return f"{self.slug}: {self.name}"


class Classroom(LoggingModel, StatusModel, TimeStampedModel):
    """
    One specific occurrence of a classroom for a given teacher in a given period.
    """

    class Status(models.IntegerChoices):
        ACTIVE = 1, _("Active")
        PRIVATE = 2, _("Private")
        ARCHIVED = 3, _("Archived")

    status: Status
    public_id = fields.public_id()
    instructor = models.ForeignKey[User, User](
        to=User,
        on_delete=models.PROTECT,
        related_name="classrooms_as_instructor",
    )
    instructor_id: str
    discipline = models.ForeignKey[Discipline, Discipline](
        to=Discipline,
        on_delete=models.PROTECT,
        related_name="classrooms",
    )
    discipline_id: str
    edition = models.CharField(
        _("edition"),
        max_length=10,
        validators=[validators.classroom_edition],
        help_text=_(
            "Identify unique classrooms for the same discipline of an instructor"
        ),
    )
    description = models.CharField(
        verbose_name=_("description"),
        max_length=255,
        help_text=_("A short description of the classroom"),
    )
    students = models.ManyToManyField(
        to=User,
        verbose_name=_("students"),
        related_name="classrooms_as_student",
        blank=True,
    )
    staff: models.ManyToManyField[User, Self] = models.ManyToManyField(
        to=User,
        verbose_name=_("staff"),
        related_name="classrooms_as_staff",
        blank=True,
    )
    timezone = models.CharField(
        _("timezone"),
        max_length=64,
        default=settings.TIME_ZONE or "UTC",
        help_text=_("The timezone of the classroom"),
    )
    start = models.DateField[date, date](
        _("Initial date"),
        help_text=_("The start date of the course/classroom"),
    )
    end = models.DateField[date, date](
        _("Final date"),
        help_text=_("The end date of the course/classroom"),
    )
    schedule_initialized = models.BooleanField[bool, bool](
        _("Initialized"),
        default=False,
        editable=False,
    )
    enrollment_code = models.CharField(
        _("Registration code"),
        max_length=8,
        default=util.registration_code,
        help_text=_("Secret code used to enroll new students"),
        unique=True,
        db_index=True,
    )
    disable_enrollment_at = models.DateTimeField(
        _("Disable enrollment at given date"),
        blank=True,
        null=True,
    )

    active: models.QuerySet[Classroom]
    archived: models.QuerySet[Classroom]
    private: models.QuerySet[Classroom]
    time_slots: models.Manager[TimeSlot]
    tags = TaggableManager()

    class Meta:
        verbose_name = _("Classroom")
        verbose_name_plural = _("Classrooms")
        ordering = ["-created"]
        constraints = [
            models.constraints.UniqueConstraint(
                fields=["instructor", "discipline", "edition"],
                name="unique_discipline_teacher_version",
            )
        ]

    @property
    def events(self) -> models.QuerySet[Event]:
        """
        Return all events for this classroom.
        """
        from ..schedules.models import Event

        return Event.objects.filter(time_slot__classroom=self)

    @property
    def slug(self) -> str:
        """
        A unique identification for classroom used to construct urls and path
        segments.
        """
        return f"{self.discipline_id}/{self.instructor.username}_{self.edition}"

    @property
    def title(self) -> str:
        """
        A human readable title for the classroom.
        """
        return f"{self.discipline.name} ({self.edition})"

    @property
    def tzinfo(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def disable_enrollment(self) -> bool:
        expires = self.disable_enrollment_at
        return expires is not None and expires < timezone.now()

    def __str__(self) -> str:
        return self.slug

    def enroll_student(self, user: User):
        """
        Register a new student in the classroom.
        """
        if self.disable_enrollment:
            raise ValidationError(
                _("Enrollment disabled for classroom."),
                code="enroll-disabled",
            )
        elif user.pk == self.instructor_id:
            raise ValidationError(
                _("Teacher cannot enroll as student."),
                code="enroll-as-instructor",
            )
        elif self.staff.filter(username=user.username):
            raise ValidationError(
                _("Staff member cannot enroll as student."),
                code="enroll-as-staff",
            )
        elif user.role == User.Role.ADMIN:
            raise ValidationError(
                _("Administrative accounts cannot enroll in classrooms."),
                code="enroll-as-admin",
            )
        elif self.students.filter(username=user.username):
            raise ValidationError(
                _("Already enrolled as student."),
                code="enroll-already-enrolled",
            )
        elif self.status != self.Status.ACTIVE:
            name = self.Status(self.status).name
            raise ValidationError(
                _("Classroom is not active"),
                code=f"enroll-{name}",
            )
        self.students.add(user)

    def register_staff(self, user: User):
        """
        Register a new user as staff.
        """

        if user == self.instructor:
            raise ValidationError(_("Teacher cannot enroll as staff."))
        self.students.add(user)
