from django.contrib import admin
from django.utils.translation import gettext_lazy as _

from . import models


@admin.register(models.Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["user__email", "user__role", "user__school_id", "user__github_id"]
    fieldsets = [
        (
            _("Personal information"),
            {
                "fields": ["gender", "date_of_birth"],
            },
        ),
        (
            _("Profile"),
            {
                "fields": [
                    "mugshot",
                    "website",
                    "bio",
                ],
            },
        ),
    ]
