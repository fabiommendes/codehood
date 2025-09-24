from typing import Annotated, Literal
from pydantic import BaseModel, Field
from rich import print_json
import json

MediaItem = str
Footnote = str


class BaseQuestion(BaseModel):
    """
    Common fields for all question types
    """

    id: Annotated[
        str,
        Field(
            description="A unique identifier for the question in the set.", min_length=1
        ),
    ]
    title: Annotated[
        str | None,
        Field(
            description="The question title. It is used to display a friendly name in the user interface. It is  different from the ID in that it is a human-readable name which is intended for displaying to the user.\n",
            min_length=1,
        ),
    ] = None
    stem: Annotated[
        str,
        Field(
            description="The main command for the question. It should be short and objective and  fits in a single paragraph. It can be written as a question or an incomplete sentence. Longer paragraphs of introductory text can be added in the preamble.\n",
            examples=[
                "Select the correct answer.",
                "How much is 2 + 2?",
                "The capital of France is...",
            ],
            min_length=1,
        ),
    ]
    type: Annotated[str, Field(description="Discriminator for the question type.")]
    format: Annotated[
        Literal["md", "text"], Field(description="How to interpret textual strings.")
    ] = "md"
    weight: Annotated[
        float | None,
        Field(
            description="The weight of the question in points. It is used to compute the final grade. The default  value is 100. The weight is multiplied by the grade of the question to compute the final  grade.\n"
        ),
    ] = 100
    grading: Annotated[
        str | None,
        Field(
            description="Describes how the question should be graded. Usually grades are represented as a percentage between 0 and 100. In order to award different points to different questions, use the weight field instead of tweaking this field.\n"
        ),
    ] = None
    preamble: Annotated[
        str | None,
        Field(
            description="An optional text introducing the subject matter of the question."
        ),
    ] = ""
    epilogue: Annotated[
        str | None,
        Field(description="An optional text that is shown after the question."),
    ] = ""
    comment: Annotated[
        str | None,
        Field(description="An optional text that is shown only to the teacher."),
    ] = ""
    footnotes: Annotated[
        list[Footnote] | None,
        Field(
            description="A list of footnotes declared in the preamble, epiloque or in the main text of the question.\n"
        ),
    ] = []
    media: Annotated[
        list[MediaItem] | None,
        Field(
            description="A list of media objects like images and videos that can be referenced in the question.\n"
        ),
    ] = []


class Footnote(BaseModel):
    id: Annotated[
        str, Field(description="An identifier for the footnote.", min_length=1)
    ]
    text: Annotated[
        str, Field(description="The text associated with the footnote.", min_length=1)
    ]


class MediaItem(BaseModel):
    id: Annotated[
        str, Field(description="An identifier for the media object.", min_length=1)
    ]
    type: Annotated[
        Literal["img", "video"], Field(description="The of the media object.")
    ]
    url: Annotated[
        str, Field(description="The URL for the media object.", min_length=1)
    ]
    caption: Annotated[
        str | None, Field(description="A caption for the media object.")
    ] = None


schema = BaseQuestion.model_json_schema()
print_json(json.dumps(schema))
