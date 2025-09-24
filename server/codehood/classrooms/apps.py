from django.apps import AppConfig


class ClassroomsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "codehood.classrooms"

    def ready(self):
        # Prevent circular dependencies
        from ..exams.models import Exam
        from ..questions.models import Question
        from . import models

        models.Question = Question
        models.Exam = Exam
