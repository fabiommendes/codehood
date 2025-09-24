from django.contrib import admin
from django.utils.translation import gettext_lazy as _

from . import models


@admin.register(models.BearerToken)
class DisciplineAdmin(admin.ModelAdmin):
    list_display = ["user", "content", "expired", "created"]
    list_filter = ["user", "expiration", "created"]

    @admin.display(description=_("Expired"))
    def expired(self, obj: models.BearerToken) -> bool:
        return obj.expired
