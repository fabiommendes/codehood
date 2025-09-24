from __future__ import annotations
from typing import TYPE_CHECKING
from django.contrib.auth import authenticate, login
from django.http import HttpRequest
from django.utils import timezone
from ninja.errors import AuthenticationError
from ninja import security


if TYPE_CHECKING:
    from . import models

__all__ = ["BearerToken", "VeryUnsecure", "UsernamePassword"]


class BearerToken(security.HttpBearer):
    model: type[models.BearerToken]

    def __init__(self):
        super().__init__()
        from .models import BearerToken

        self.model = BearerToken

    def authenticate(self, request: HttpRequest, token: str):
        """
        Authenticate the user using the Bearer token.
        """
        try:
            db = self.model.objects.get(content=token)
        except self.model.DoesNotExist:
            raise AuthenticationError(message="Invalid token")

        if db.expiration and db.expiration < timezone.now():
            raise AuthenticationError(message="Token expired")

        request.user = db.user
        return token


class VeryUnsecure(security.HttpBearer):
    def authenticate(self, request, token):
        from ..users.models import User

        try:
            user = User.objects.get(username=token)
        except User.DoesNotExist:
            return None
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return token


class UsernamePassword(security.HttpBasicAuth):
    def authenticate(self, request, username, password):
        if authenticate(request, email=username, password=password):
            return username
