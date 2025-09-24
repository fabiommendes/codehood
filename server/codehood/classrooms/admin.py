from django.contrib import admin
from django.contrib.admin.decorators import display
from django.utils.translation import gettext_lazy as _

from . import models


@admin.register(models.Discipline)
class DisciplineAdmin(admin.ModelAdmin):
    list_display = ["name", "slug"]


@admin.register(models.Classroom)
class ClassroomAdmin(admin.ModelAdmin):
    list_display = [
        "discipline__slug",
        "path",
        "instructor__name",
        "num_students",
    ]
    list_filter = ["status", "discipline"]

    @display(description=_("Path"))
    def path(self, obj: models.Classroom) -> str:
        return f"{obj.instructor.username}_{obj.edition}"

    @display(description=_("Enrolled students"))
    def num_students(self, obj: models.Classroom) -> int:
        return obj.students.count()
