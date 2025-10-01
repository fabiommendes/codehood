from django.contrib import admin

from . import models


@admin.register(models.Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ["exam__classroom", "slug", "exam", "title", "type"]
    list_filter = [
        "exam__classroom__discipline",
        "exam__kind",
        "exam__start",
        "exam__end",
        "type",
    ]
