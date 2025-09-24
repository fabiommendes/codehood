from django.http import HttpRequest
from django.utils.translation import gettext as _
from ninja import ModelSchema
from shuriken import BaseController, get

from codehood.api import rest
from . import models


@rest.controller("/account", tags=[_("Account Management")])
class AccountController(BaseController):
    class Profile(ModelSchema):
        class Meta:
            model = models.Profile
            fields = "__all__"

    @get("/profile", response=Profile)
    def get_profile(self, request: HttpRequest) -> models.Profile:
        """
        Return the complete user profile.
        """
        return self.get_user_or_404(request).profile
