from __future__ import annotations
import functools
import secrets
from datetime import datetime, timedelta

from typing import Callable
from django.db import models
from django.db.models.functions import Now
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from ..users.models import User

TOKEN_NUM_BYTES = 16
TOKEN_B64_LENGTH = TOKEN_NUM_BYTES * 4 // 3 + 1


def token_content(size: int) -> Callable[[], str]:
    """
    Generate a random token.
    """
    return functools.partial(secrets.token_urlsafe, size)


class BearTokenManager(models.Manager["BearerToken"]):
    """
    Custom manager for BearerToken.
    """

    def new(
        self, user: User, expiration: datetime | timedelta | None = None
    ) -> BearerToken:
        """
        Create a new BearerToken instance for user.
        """
        if isinstance(expiration, timedelta):
            expiration = timezone.now() + expiration
        if isinstance(expiration, datetime):
            expiration = timezone.make_aware(expiration)
        if expiration and expiration < timezone.now():
            raise ValueError("Expiration date must be in the future.")

        token = BearerToken(user=user, expiration=expiration)
        token.save()
        return token

    def get_token(
        self,
        user: User,
        recycle: bool = True,
        expiration: datetime | timedelta | None = None,
    ) -> str:
        """
        Return a token for user, recyling it if possible.
        """
        if not recycle and expiration is not None:
            token = self.new(user=user, expiration=expiration)
        else:
            token, _ = self.get_or_create(user=user, expiration=None)
        return token.content

    def invalidate_all(self, user: User, soft_delete: bool = False) -> None:
        """
        Invalidate all tokens associated with a user.
        """
        tokens = self.filter(user=user)
        if soft_delete:
            tokens.update(expiration=Now())
        else:
            tokens.delete()

    def clear_expired(self) -> None:
        """
        Clear all expired tokens.
        """
        self.filter(expiration__lt=Now()).delete()

    def clear_older_than(self, date: datetime | timedelta) -> None:
        """
        Clear all tokens older than a given date.
        """
        if isinstance(date, timedelta):
            if date.total_seconds() < 0:
                raise ValueError("Please provide a positive timedelta.")
            date = timezone.now() - date

        self.filter(created__lt=date).delete()


class BearerToken(models.Model):
    """
    A simple bearer token authentication model.
    """

    class Meta:
        verbose_name = _("Bearer token")
        verbose_name_plural = _("Bearer tokens")

    user = models.ForeignKey(
        to=User,
        on_delete=models.CASCADE,
        related_name="tokens",
        verbose_name=_("User"),
    )
    content = models.CharField(
        _("Token"),
        max_length=255,
        primary_key=True,
        editable=False,
        default=token_content(TOKEN_B64_LENGTH),
        help_text=_("The token data used for authentication."),
    )
    expiration = models.DateTimeField(
        _("Expiration"),
        null=True,
        blank=True,
        help_text=_("The expiration date of the token."),
    )
    created = models.DateTimeField(
        _("Created"),
        auto_now_add=True,
        help_text=_("The date the token was created."),
    )
    objects: BearTokenManager = BearTokenManager()

    @property
    def expired(self) -> bool:
        """
        Check if the token is expired.
        """
        if self.expiration:
            return self.expiration < timezone.now()
        return False

    def invalidate(self, soft_delete: bool = False) -> None:
        """
        Invalidate the token.

        If soft_delete is True, the token will be marked as expired, but not
        deleted.
        """
        if soft_delete:
            self.save(update_fields=["expiration"])
        else:
            self.delete()
