from typing import Annotated

from pydantic import Field

from .base import Model
from .enums import TextFormat
from .question import (
    Associative,
    CodeIo,
    Essay,
    FillIn,
    MultipleChoice,
    MultipleSelection,
    TrueFalse,
    UnitTest,
)
from .shared import DefaultGrading, Footnote, MediaItem


class Exam(Model):
    """
    A document with a sequence of questions.
    """

    class Config:
        extra = "forbid"

    id: Annotated[
        str,
        Field(
            description="A (ideally) unique identifier for the question set",
            min_length=1,
        ),
    ]
    title: Annotated[
        str, Field(description="A name for the collection of questions")
    ] = ""
    description: Annotated[
        str, Field(description="Some additional description for the exam")
    ] = ""
    preamble: Annotated[
        str, Field(description="An introductory text displayed to students")
    ] = ""
    epilogue: Annotated[
        str,
        Field(description="An optional text that is shown after the question."),
    ] = ""
    comment: Annotated[
        str,
        Field(description="An optional text that is shown only to the teacher."),
    ] = ""
    footnotes: Annotated[
        list[Footnote],
        Field(
            description="A list of footnotes declared in the main text of the question.",
            default_factory=list,
        ),
    ]
    media: Annotated[
        list[MediaItem] | None,
        Field(
            description="A list of media objects like images and videos that can be referenced in the question.",
            default_factory=list,
        ),
    ]
    tags: Annotated[
        set[str],
        Field(
            description="Some tags that can be attached to the exam.",
            default_factory=set,
        ),
    ]
    questions: Annotated[
        list[
            MultipleChoice
            | MultipleSelection
            | TrueFalse
            | Associative
            | FillIn
            | Essay
            | CodeIo
            | UnitTest
        ],
        Field(description="List of questions", min_items=1),
    ]
    format: Annotated[
        TextFormat, Field(description="How to interpret textual strings.")
    ] = TextFormat.MARKDOWN
    grading: Annotated[
        DefaultGrading,
        Field(
            description="Describes how the question should be graded.",
            default_factory=DefaultGrading,
        ),
    ]
    shuffle: Annotated[
        bool,
        Field(
            description="Shuffle order of choices when it is safe to do so.\n"
            "Set the default configuration for all questions in this exam.",
        ),
    ] = False
