from django.contrib import admin
from django.contrib.admin.decorators import display
from django.utils.translation import gettext_lazy as _

from . import models


@admin.register(models.Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ["classroom", "title", "owner", "num_questions"]
    list_filter = ["classroom", "classroom__discipline", "start", "end", "kind"]

    @display(description=_("Number of Questions"))
    def num_questions(self, obj: models.Exam) -> int:
        return obj.questions.count()
