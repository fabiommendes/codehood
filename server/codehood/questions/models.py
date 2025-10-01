from __future__ import annotations

import hashlib
from typing import Any

import mdq
from django.core.files import File
from django.core.validators import MinLengthValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from .. import yaml as _yaml
from ..exams.models import Exam
from ..types import TaggableManager, Tags


class Question(models.Model):
    """
    A simple question.
    """

    class Format(models.TextChoices):
        MARKDOWN = mdq.Format.MARKDOWN, _("Markdown")
        TEXT = mdq.Format.TEXT, _("Text")

    class Type(models.TextChoices):
        ASSOCIATIVE = mdq.QuestionType.ASSOCIATIVE, _("Associative")
        CODE_IO = mdq.QuestionType.CODE_IO, _("Code I/O")
        ESSAY = mdq.QuestionType.ESSAY, _("Essay")
        FILL_IN = mdq.QuestionType.FILL_IN, _("Fill in the blanks")
        MULTIPLE_CHOICE = mdq.QuestionType.MULTIPLE_CHOICE, _("Multiple choice")
        MULTIPLE_SELECTION = mdq.QuestionType.MULTIPLE_SELECTION, _("Multiple select")
        TRUE_FALSE = mdq.QuestionType.TRUE_FALSE, _("True/False")
        UNIT_TEST = mdq.QuestionType.UNIT_TEST, _("Unit tests")

    exam = models.ForeignKey[Exam](
        to=Exam,
        on_delete=models.CASCADE,
        related_name="questions",
    )
    slug = models.SlugField[str, str](
        _("id"),
        help_text=_("Unique identifier per exam."),
    )
    type = models.CharField[Type, Type](
        _("question type"),
        choices=Type,
        max_length=20,
        help_text=_("Question type"),
    )
    title = models.CharField[str, str](
        _("title"),
        max_length=255,
        validators=[MinLengthValidator(1)],
        help_text=_("Title of the question"),
    )
    stem = models.TextField[str, str](
        _("stem"),
        validators=[MinLengthValidator(1)],
        help_text=_("A short prompt or question to be answered."),
    )
    format = models.CharField[str, str](
        _("format"),
        choices=Format.choices,
        default=Format.MARKDOWN,
        max_length=4,
        help_text=_("Format of textual data used in the question"),
    )
    points = models.FloatField[float, float](
        _("points"),
        default=1.0,
        help_text=_("How much the question is worth in the exam"),
    )
    preamble = models.TextField[str, str](
        _("preamble"),
        blank=True,
        help_text=_("A short introduction to the question"),
    )
    epilogue = models.TextField[str, str](
        _("epilogue"),
        blank=True,
        help_text=_(
            "A short conclusion to the question. This text will be shown after the main prompt."
        ),
    )
    comments = models.TextField[str, str](
        _("comments"),
        blank=True,
        help_text=_(
            "Private observations about the question. It will not be shown to students."
        ),
    )
    shuffle = models.BooleanField[bool, bool](
        _("shuffle"),
        default=True,
        help_text=_(
            "If true, items in the question such as the choices in multiple choice questions may be shuffled before being shown to the student."
        ),
    )
    data = models.JSONField(
        _("Internal representation"),
        help_text=_(
            "internal representation in JSON. Only edit if you REALLY know what are you doing."
        ),
    )
    tags: Tags = TaggableManager()
    objects: models.Manager[Question]

    class Meta:
        unique_together = [("exam", "slug")]

    def __init__(self, *args, **kwargs):
        if "yaml" in kwargs:
            kwargs["data"] = _yaml.parse(kwargs.pop("yaml"))
        super().__init__(*args, **kwargs)

    def __str__(self) -> str:
        return self.title

    def clean_fields(self, exclude=None):
        # Accept YAML strings in the data field
        if (
            not exclude
            or "data" not in exclude
            and isinstance(self.data, str)
            and not self.data.lstrip().startswith("{")
        ):
            self.data = _yaml.parse(self.data)
        super().clean_fields(exclude=exclude)

    def as_json(self) -> dict:
        """
        Returns the question as a JSON object.
        """
        return {
            "id": self.slug,
            "type": str(self.type),
            "title": self.title,
            "stem": self.stem,
            "format": str(self.format),
            "weight": self.points,
            "preamble": self.preamble,
            "epilogue": self.epilogue,
            "comments": self.comments,
            "shuffle": self.shuffle,
            "tags": [str(tag) for tag in self.tags.all()],
            **self.data,
        }

    def hash_answer(self, data: Any):
        """
        Validates and hashes the answer data.
        """
        match self.type:
            case self.Type.MULTIPLE_CHOICE | self.Type.MULTIPLE_SELECTION:
                return hash_choices_answer_set(data)
            case self.Type.TRUE_FALSE:
                return hash_true_false_answer_set(data)
            case _:
                raise NotImplementedError(f"Hashing not implemented for {self.type}")


class Attatchment(models.Model):
    """
    A file attatchment for a question.
    """

    question = models.ForeignKey[Question](
        to=Question,
        on_delete=models.CASCADE,
        related_name="attatchments",
    )
    path = models.TextField[str, str](
        _("path"),
        help_text=_("The attatched file."),
    )
    file = models.FileField[File, File](
        _("file"),
        upload_to="questions/attatchments/",
        help_text=_("The attatched file."),
    )
    description = models.CharField(
        _("description"),
        max_length=255,
        blank=True,
        help_text=_("A short description of the attatchment."),
    )

    class Meta:
        verbose_name = _("Attatchment")
        verbose_name_plural = _("Attatchments")
        unique_together = [("question", "path")]

    def __str__(self) -> str:
        return f"Attatchment for {self.question.slug}: {self.path}"


def hash_choices_answer_set(data: set[str]) -> bytes:
    """
    Hashes the answer set for multiple choice and multiple selection questions.
    """
    md5 = hashlib.md5()
    for item in sorted(data):
        md5.update(item.encode("utf-8"))
        md5.update(b";")
    return md5.digest()


def hash_true_false_answer_set(data: dict[str, bool]) -> bytes:
    """
    Hashes the answer set for true/false questions.
    """
    md5 = hashlib.md5()
    for k, v in sorted(data.items()):
        md5.update(k.encode("utf-8"))
        if k is True:
            md5.update(b":true")
        elif k is False:
            md5.update(b":false")
        md5.update(b";")
    return md5.digest()
