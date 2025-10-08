from abc import ABC
from typing import Annotated

from pydantic import Field

from .base import Model


class BaseResponse(Model, ABC):
    """
    A student's response to a question.
    """

    class Config:
        extra = "forbid"

    question_id: Annotated[
        str,
        Field(
            description="A unique identifier for the question associated with the response",
            min_length=1,
        ),
    ]


class MultipleChoiceResponse(BaseResponse):
    """
    A student's response to multiple-choice and multiple selection questions.
    """

    selected_choice_ids: Annotated[
        list[int],
        Field(
            description="A list of identifiers for the choices selected by the student",
            default_factory=list,
        ),
    ]


type MultipleSelectionResponse = MultipleChoiceResponse


class TrueFalseResponse(BaseResponse):
    """
    A student's response to true/false questions.
    """

    answer: Annotated[
        dict[int, bool],
        Field(description="The student's answer to the true/false question"),
    ]
