from typing import Annotated, Literal

from pydantic import Field, RootModel

from .base import Model
from .enums import ArtifactType, InputType, MediaType, ProgrammingLanguage


class IntervalGrading(Model):
    """
    How the question should be graded.

    Usually grades are represented as a percentage between 0 and 100. In order
    to award different points to different questions, use the weight field
    instead of tweaking this field.
    """

    min_value: Annotated[
        float | None,
        Field(
            description="The minimum value for the grade. "
            "If the computed grade is below this value, the final value is truncated. "
            "Null represents an unbounded value."
        ),
    ] = None
    max_value: Annotated[
        float | None,
        Field(
            description="The maximum value for the grade. "
            "If the computed grade is above this value, the final value is truncated. "
            "Null represents an unbounded value."
        ),
    ] = None


class TrueFalseGrading(Model):
    """
    A grading strategy for true-false questions. Points are awarded in the 0-100 range.
    """

    correct_grade: Annotated[
        float | None,
        Field(
            description="The number of points awarded for a correct answer. "
            "This is usually a percentage between 0 and 100."
        ),
    ] = 100
    penalty_for_incorrect: Annotated[
        float | None,
        Field(
            description="The number of points subtracted for an incorrect answer. "
            "This is usually a percentage between 0 and 100."
        ),
    ] = 0


class DefaultGrading(TrueFalseGrading, IntervalGrading):
    """
    Grading options for all question types.

    This is used in exams.
    """


class Footnote(Model):
    id: Annotated[
        str, Field(description="An identifier for the footnote.", min_length=1)
    ]
    text: Annotated[
        str, Field(description="The text associated with the footnote.", min_length=1)
    ]


class MediaItem(Model):
    id: Annotated[
        str, Field(description="An identifier for the media object.", min_length=1)
    ]
    type: Annotated[MediaType, Field(description="The type of the media object.")]
    url: Annotated[
        str, Field(description="The URL for the media object.", min_length=1)
    ]
    caption: Annotated[
        str | None, Field(description="A caption for the media object.")
    ] = None


class Choice(Model):
    text: Annotated[
        str, Field(description="The textual content for the choice", min_length=1)
    ]
    feedback: Annotated[
        str,
        Field(
            description="The feedback text shown to students that selected that choice."
        ),
    ] = ""
    fixed: Annotated[
        bool,
        Field(
            description="Whether the choice is fixed in place and cannot be shuffled. "
            'This is useful for specifing options like "all of the above", "none of the above", etc. '
            "The non-fixed choices may be shuffled if the question is marked as safe to be shuffled."
        ),
    ] = False
    correct: Annotated[
        None | bool | float,
        Field(
            description="Null, a boolean or value between 0 and 100, interpreted as a percentage. "
            "If null, it is considered incorrect and  uses the `penalty_for_incorrect` field as the value."
        ),
    ] = None


class FillInStatic(Model):
    """
    A static text snippet. This is not graded.
    """

    type: Literal["static"] = "static"
    text: Annotated[
        str, Field(description="The text to be displayed.", min_length=1)
    ] = ""


class FillInText(Model):
    """
    The answer is a short string of text and the grading is done by comparing it with the reference answer key.

    For longer answers, please use the "essay" question type.
    """

    type: Literal["text"] = "text"
    answer_key: Annotated[
        str | list[str] | None,
        Field(
            alias="answer-key",
            description="The answer key. It can be specified in different ways:\n"
            " - A single string, which is the correct answer.\n"
            " - An array of strings, which are all correct answers.\n"
            " - A regular expression enclosed in slashes, which is used to match the answer.\n"
            " - A null value, which denotes that the question must be graded manually.",
            examples=[
                "Paris",
                "/^Paris$/i",
                ["New York", "NYC"],
            ],
        ),
    ] = None
    case_sensitive: Annotated[
        bool,
        Field(
            alias="case-sensitive",
            description="Whether to consider case when comparing the answer with the reference value.",
        ),
    ] = False


class FillInNumeric(Model):
    """
    The answer is a number and the grading is done by comparing with the answer
    key within a tolerance.
    """

    type: Literal["numeric"] = "numeric"
    answer_key: Annotated[
        float | int,
        Field(alias="answer-key", description="The correct numerical answer."),
    ] = None
    tolerance: Annotated[
        float | str | None,
        Field(
            description="The tolerance for the answer. The answer is correct if it is within this tolerance of the correct answer.",
            examples=[0.1, "±5%", "±10.5%"],
        ),
    ] = 0
    unit: Annotated[
        str | None,
        Field(
            description="The unit for the answer. It is usually displayed in the input box after the number.",
            examples=["m", "kg", "s", "meters"],
        ),
    ] = None


class FillInSelection(Model):
    """
    A selection box with a list of choices.
    """

    type: Literal["selection"] = "selection"
    choices: Annotated[
        list[Choice],
        Field(description="The list of choices for the question", min_items=2),
    ] = None


class AssociativeItemText(Model):
    text: Annotated[str, Field(description="The text to be displayed.")]
    style: Annotated[
        InputType | ProgrammingLanguage | None,
        Field(description="Apply styles on how the text should be displayed."),
    ] = InputType.TEXT


class AssociativeItemImage(Model):
    url: Annotated[str, Field(description="An url relative to the question file.")]
    alt: Annotated[
        str,
        Field(
            description='The "alt" tag for the image. It is used to display a text when the image cannot be loaded and for assistive technology. The alt text is never formatted as Markdown.'
        ),
    ]


class AssociativeKey(Model):
    """
    Properties for association keys.
    """

    answer_key: Annotated[
        list[str],
        Field(
            alias="answer-key",
            description="A list of ids representing correct associations.",
        ),
    ] = None
    feedback: Annotated[
        dict[str, str] | None,
        Field(
            description="The feedback text shown to studends that selected specific associations.\n"
        ),
    ] = None


class Compilation(Model):
    """
    A dictionary mapping programming languages with their corresponding compilation environments. The options vary on a per-language basis and are encoded as somewhat arbitrary JSON objects.

    """

    class Config:
        extra = "allow"

    type: Annotated[
        str,
        Field(
            description="Encodes the type of environment selected for the language.",
            min_length=1,
        ),
    ]
    artifact: Annotated[
        str, Field(description="Name of the produced artifact.", min_length=1)
    ] = ""
    artifact_type: Annotated[
        ArtifactType,
        Field(
            alias="artifact-type",
            description="The type of artifact produced by the compilation. It is used to determine how to execute the code.\n",
        ),
    ] = ArtifactType.EXECUTABLE


class Environment(Model):
    """
    A dictionary mapping programming languages with their corresponding execution environment. The options vary on a per-language basis and are encoded as arbitrary JSON objects with a required "type" key. Each language is associated with a single environment. It is up to the execution environment interpret how the environment options affect how code is  executed.

    """

    class Config:
        extra = "allow"

    type: Annotated[
        str,
        Field(
            description="Encodes the type of environment selected for the language.",
            min_length=1,
        ),
    ]


class Linting(Model):
    """
    A dictionary mapping programming languages with their corresponding linting options. Linting is executed on successful submissions and can discount points for style and poor practices.

    """

    class Config:
        extra = "allow"

    type: Annotated[
        str | None,
        Field(
            description="The selected linter mechanism and their options.", min_length=1
        ),
    ] = None


ForbiddenSyntax = RootModel[
    Annotated[
        dict[str, int],
        Field(
            description="A mapping of keywords (if, for, etc) with the maximum number of times they can occur in the code.",
            min_length=1,
        ),
    ]
]


class Conf(Model):
    """
    A dictionary with configuration options for how the student respons will be matched with the answer key.
    """

    match_spaces: Annotated[
        bool | None,
        Field(
            alias="match-spaces",
            description="Whether to normalize when comparing the output with the expected output. If true, it ignores trailing whitespaces at each line and tries to find a tab size that would match sequences of spaces to sequences of tabs.\n",
        ),
    ] = False
    case_sensitive: Annotated[
        bool | None,
        Field(
            alias="case-sensitive",
            description="If true (default), ignore case when matching strings.\n",
        ),
    ] = True
    ignore_accents: Annotated[
        bool | None,
        Field(
            alias="ignore-accents",
            description="If true, normalize unicode strings to remove accents and diacritics.\n",
        ),
    ] = False


class CodeIOExample(Model):
    input: Annotated[
        str,
        Field(description="The input string be passed to the program.", min_length=1),
    ]
    output: Annotated[
        str, Field(description="The expected output for this execution.", min_length=1)
    ]


class CodeIOInputs(Model):
    inputs: Annotated[
        list[str],
        Field(
            description="An array with inputs that should be passed to the answer key implementation.\n",
            min_length=1,
        ),
    ]


class CodeIOSpec(Model):
    iospec: Annotated[
        str,
        Field(
            description="An iospec source code describing the program interaction.",
            min_length=1,
        ),
    ]
