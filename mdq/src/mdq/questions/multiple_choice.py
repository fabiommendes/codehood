from __future__ import annotations

from pydantic.dataclasses import dataclass, Field
from decimal import Decimal
from typing import Iterable

from .question import Issue, Question, QuestionType, RichText


class MultipleChoiceQuestion(Question):
    """
    A multiple choice question.
    """

    description: RichText
    choices: list[Choice]
    is_ordered: bool = False
    type = QuestionType.MULTIPLE_CHOICE

    def check_errors(self) -> Iterable[Issue]:
        yield from self.check_id_fields()


@dataclass
class Choice:
    text: RichText
    feedback: RichText
    value: Decimal = Decimal(0)

    @property
    def is_correct(self) -> bool:
        return self.value >= 1

    @property
    def is_partial(self) -> bool:
        return self.value > 0
