from __future__ import annotations

import typing

from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from ..classrooms.models import Classroom
from ..users.models import User
from .utils import normalize_passphase, random_passphrase


class Passphrase(models.Model):
    """
    Students can automatically subscribe to classrooms by providing a valid phassprase.

    Passphrases are ephemeral and can be recycled once expired.
    """

    if typing.TYPE_CHECKING:
        classroom: Classroom

    classroom = models.ForeignKey(  # type: ignore[assignment]
        Classroom,
        verbose_name=_("Classroom"),
        on_delete=models.CASCADE,
    )
    expires = models.DateTimeField(
        _("expiration date"),
        help_text=_("Passphrase cannot be used after this time."),
    )
    passphrase = models.CharField(
        _("subscription passphrase"),
        default=random_passphrase,
        unique=True,
        max_length=8,
        help_text=_(
            "A passphrase/word that students must enter to subscribe in the "
            "classroom. Leave empty if no passphrase should be necessary."
        ),
    )

    class Meta:
        ordering = ["-expires"]

    @classmethod
    def register(cls, passphrase: str, user: User, register=True) -> Classroom | None:
        """
        Try to register to classroom using passphrase.

        Return the classroom if successful.
        """
        passphrase = normalize_passphase(passphrase)

        try:
            obj = typing.cast(Passphrase, cls.objects.get(passphrase=passphrase))
        except cls.DoesNotExist:
            return None

        if obj.expires < timezone.now():
            obj.delete()
            return None

        if register:
            obj.classroom.enroll_student(user)

        return obj.classroom
