from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

from django.contrib.auth.models import AbstractUser
from django.core.validators import MinLengthValidator
from django.db import models
from django.urls import reverse

from codehood.text import gettext_lazy as _

from . import validators
from .managers import UserManager

if TYPE_CHECKING:
    from django_stubs_ext.db.models.manager import RelatedManager

    from ..classrooms.models import Classroom


class User(AbstractUser):
    """
    Default custom user model for {{cookiecutter.project_name}}.
    If adding fields that need to be filled at user signup,
    check forms.SignupForm and forms.SocialSignupForms accordingly.
    """

    class Role(models.IntegerChoices):
        INSTRUCTOR = 1, _("Instructor")
        STUDENT = 2, _("Student")
        ADMIN = 3, _("Administrative staff")

    class Meta:
        unique_together = [("school_id", "role")]

    name = models.CharField(
        _("Name of User"),
        max_length=255,
        help_text=_("Type the full name"),
    )
    first_name = None  # type: ignore[assignment]
    last_name = None  # type: ignore[assignment]
    email = models.EmailField(
        _("email address"),
        unique=True,
        help_text=_("Email is also used for login"),
    )
    username = models.CharField(
        _("username"),
        max_length=64,
        primary_key=True,
        help_text=_(
            "Required. 64 characters or fewer. Letters, digits and ./+/-/_ only."
        ),
        validators=[
            AbstractUser.username_validator,
            validators.no_at_symbol,
            MinLengthValidator(3),
        ],
        error_messages={
            "unique": _("A user with that username already exists."),
        },
    )
    role = models.SmallIntegerField[Role, Role](
        choices=Role,
        default=Role.STUDENT,
        editable=False,
        help_text=_("User's role in the organization"),
    )
    school_id = models.CharField(
        _("school id"),
        max_length=50,
        help_text=_("Identification number in your school issued id card."),
    )
    github_id = models.CharField(
        _("github username"),
        max_length=50,
        unique=True,
        validators=[validators.github_username],
        error_messages={
            "unique": _("A user with that github username already exists."),
        },
        help_text=_("Your github username."),
    )

    @property
    def id(self) -> str:
        return self.username

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    # Reversed accessors
    objects: ClassVar[UserManager] = UserManager()
    classrooms_as_instructor: RelatedManager[Classroom]
    classrooms_as_staff: RelatedManager[Classroom]
    classrooms_as_student: RelatedManager[Classroom]

    def get_absolute_url(self) -> str:
        """Get URL for user's detail view.

        Returns:
            str: URL for user detail.
        """
        return reverse("users:detail", kwargs={"pk": self.pk})

    def clean(self):
        if self.is_superuser:
            return
        else:
            validators.school_id_for_role(self.role, self.school_id)


validators.User = User  # type: ignore[misc]
