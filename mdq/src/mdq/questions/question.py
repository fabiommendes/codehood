from __future__ import annotations

from pydantic import BaseModel
from pydantic.dataclasses import dataclass
from enum import IntEnum, StrEnum
from typing import Any, ClassVar, Iterable

from ..utils import check_slug, humanize_slug

type RichText = str


class Severity(IntEnum):
    WARN = 0
    ERROR = 1

    def __str__(self):
        return self.name.lower()


class Question(BaseModel):
    "Base class for all question types."

    title: str
    slug: str
    meta: dict
    type: ClassVar[QuestionType] = NotImplemented

    def check_errors(self) -> Iterable[Issue]:
        raise NotImplementedError

    def check_id_fields(self) -> Iterable[Issue]:
        if self.title.strip() == "":
            yield Issue("title is empty", severity=Severity.WARN, attr="title")
        if self.slug.strip() == "":
            yield Issue("slug is empty", severity=Severity.ERROR, attr="slug")
        for msg in check_slug(self.slug):
            yield Issue(msg, severity=Severity.ERROR, attr="slug")

    def verify_issues(self, severity: Severity = Severity.ERROR):
        """
        Raise a ValidationError if any errors were found.
        """
        errors = []
        for error in self.check_errors():
            if error.severity >= severity:
                errors.append(error)
        if errors:
            raise ValidationError(errors)

    def normalize(self, data: dict[str, Any] = None):  # type: ignore
        """
        Normalize fields trying to reduce the number or severity of errors.
        """
        if not self.title:
            self.title = humanize_slug(self.slug, title=True)


class QuestionType(StrEnum):
    ASSOCIATIVE = "associative"
    CODE_IO = "code-io"
    ESSAY = "essay"
    FILL_IN = "fill-in"
    MULTIPLE_CHOICE = "multiple-choice"
    MULTIPLE_SELECTION = "multiple-selection"
    TRUE_FALSE = "true-false"
    UNIT_TEST = "unit-test"


class Format(StrEnum):
    MARKDOWN = "md"
    TEXT = "text"


@dataclass
class Issue:
    msg: str
    severity: Severity
    attr: str | None = None

    def __str__(self) -> str:
        return self.msg


class ValidationError(ValueError):
    """
    Exception raised when the .validate() method encounters an error.
    """

    @property
    def errors(self):
        return self.args[0]

    def __init__(self, errors: Iterable[Issue]):
        super().__init__([*errors])

    def __str__(self):
        match self.errors:
            case []:
                return "no error found!"
            case [error]:
                return str(error)
            case errors:
                return "\n".join("    " + str(error) for error in errors)
