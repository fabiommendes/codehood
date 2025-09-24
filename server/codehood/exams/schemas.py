from typing import Annotated, Any, Literal
from ninja import Field, ModelSchema, Schema
from pydantic import RootModel, model_validator

from . import models
from ..questions.models import Question as QuestionModel


class BaseQuestion(ModelSchema):
    class Meta:
        model = QuestionModel
        exclude = ["exam", "slug", "tagged_items", "type", "data"]

    id: str = Field(..., alias="slug")


class MultipleChoice(BaseQuestion):
    choices: list[dict[str, Any]]
    type: Literal["multiple-choice"]


class MultipleSelection(BaseQuestion):
    choices: list[dict[str, Any]]
    type: Literal["multiple-selection"]


class TrueFalse(BaseQuestion):
    choices: list[dict[str, Any]]
    type: Literal["true-false"]


Question = Annotated[
    MultipleChoice | MultipleSelection | TrueFalse, Field(discriminator="type")
]


class Exam(ModelSchema):
    class Meta:
        model = models.Exam
        exclude = [
            "id",
            "classroom",
            "tagged_items",
            "created",
            "modified",
            "public_id",
        ]

    id: str = Field(..., alias="public_id")
    num_questions: int
    classroom_id: str = Field(..., alias="classroom_public_id")
    instructor_id: str = Field(..., alias="owner_id")
    instructor_name: str
    questions: list[Question]


class Answer(Schema):
    id: str
    type: str
    answer: Any

    @model_validator(mode="after")
    def validate_answer(self):
        match self.type:
            case "multiple-choice" | "multiple-selection":
                self.answer = ChoicesAnswer.model_validate(self.answer).root
            case "true-false":
                self.answer = TrueFalseAnswer.model_validate(self.answer).root
            case "essay":
                self.answer = EssayAnswer.model_validate(self.answer).root
            case _:
                raise ValueError(f"Unknown answer type: {self.type}")

        return self


class ChoicesAnswer(RootModel):
    root: set[str]


class TrueFalseAnswer(RootModel):
    root: dict[str, bool]


class EssayAnswer(RootModel):
    root: str
