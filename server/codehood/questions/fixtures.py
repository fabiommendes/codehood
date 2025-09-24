import random
from string import ascii_uppercase as LETTERS
from typing import Any
from functools import cache
from itertools import cycle

from django.utils.translation import gettext as _

from .models import Exam, Question

type JSON = dict[str, Any] | list[Any] | str | int | float | bool | None
QUESTION_TYPES = cycle(
    [
        Question.Type.MULTIPLE_CHOICE,
        Question.Type.TRUE_FALSE,
        Question.Type.MULTIPLE_SELECTION,
        # Question.Type.ASSOCIATIVE,
        # Question.Type.FILL_IN,
        # Question.Type.ESSAY,
        # Question.Type.UNIT_TEST,
        # Question.Type.CODE_IO,
    ]
)


@cache
def question(
    exam: Exam, index: int = 1, type: Question.Type | None = None, **kwargs
) -> Question:
    if type is None:
        type = next(QUESTION_TYPES)

    defaults = dict(
        exam=exam,
        slug=f"q{index}",
        title=f"Question {index}",
        type=type,
        stem=_("Answer to the following prompt"),
    )
    defaults.update(kwargs)

    if "data" not in defaults:
        defaults["data"] = question_data(index, type)

    return Question.objects.create(**defaults)


def question_data(index: int, type: Question.Type) -> dict:
    match type:
        case Question.Type.MULTIPLE_CHOICE:
            return {
                "choices": choices(
                    size=5,
                    correct=[index % 5],
                    on_correct={"grade": 100.0},
                )
            }
        case Question.Type.TRUE_FALSE:
            correct = [i for i in range(5) if random.choice([True, False])]
            return {
                "choices": choices(
                    size=5,
                    correct=correct,
                    on_correct={"answer": True},
                )
            }
        case Question.Type.MULTIPLE_SELECTION:
            correct = [i for i in range(5) if random.choice([True, False])]
            return {
                "choices": choices(
                    size=5,
                    correct=correct,
                    on_correct={"grade": 100.0},
                )
            }
        case Question.Type.ASSOCIATIVE:
            return {}
        case Question.Type.FILL_IN:
            return {}
        case Question.Type.ESSAY:
            return {}
        case Question.Type.UNIT_TEST:
            return {}
        case Question.Type.CODE_IO:
            return {}
        case _:
            raise RuntimeError(f"should not happen: {type}")


def choices(size, correct, on_correct, **kwargs) -> JSON:
    data = [
        {
            "text": f"Option {letter}",
            "id": letter,
            "feedback": f"Option {letter} is wrong!",
            **kwargs,
        }
        for letter in LETTERS[:size]
    ]
    for i in correct:
        del data[i]["feedback"]
        data[i].update(on_correct)
    return data


def populate_db():
    pass  # will be done in the exams fixture ...
