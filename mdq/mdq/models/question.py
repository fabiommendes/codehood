from abc import ABC
from typing import Annotated, Any, ClassVar, Literal

from pydantic import Field

from .base import Model
from .enums import InputType, ProgrammingLanguage, TextFormat
from .shared import (
    AssociativeItemImage,
    AssociativeItemText,
    AssociativeKey,
    Choice,
    CodeIOExample,
    CodeIOInputs,
    CodeIOSpec,
    Compilation,
    Conf,
    Environment,
    FillInNumeric,
    FillInSelection,
    FillInStatic,
    FillInText,
    Footnote,
    IntervalGrading,
    Linting,
    MediaItem,
    TrueFalseGrading,
)
from ..types import NOT_GIVEN

type QuestionType = Literal[
    "multiple-choice",
    "multiple-selection",
    "associative",
    "true-false",
    "numerical",
    "matching",
    "essay",
    "fill-in",
    "code-io",
    "unit-test",
]


class BaseQuestion[Grading = IntervalGrading](Model, ABC):
    """
    Common question properties.
    """

    id: Annotated[
        str,
        Field(
            description="A unique identifier for the question in the set.", min_length=1
        ),
    ]
    title: Annotated[
        str,
        Field(
            description="The question title. It is used to display a friendly name in the user interface. It is  different from the ID in that it is a human-readable name which is intended for displaying to the user.\n",
            min_length=1,
        ),
    ] = ""
    stem: Annotated[
        str,
        Field(
            description="The main command for the question. It should be short and objective and fits in a single paragraph. It can be written as a question or an incomplete sentence. Longer paragraphs of introductory text can be added in the preamble.\n",
            examples=[
                "Select the correct answer.",
                "How much is 2 + 2?",
                "The capital of France is...",
            ],
            min_length=1,
        ),
    ]
    type: Annotated[
        QuestionType,
        Field(description="Discriminator for the question type."),
    ]
    preamble: Annotated[
        str,
        Field(
            description="An optional text introducing the subject matter of the question."
        ),
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
        list[MediaItem],
        Field(
            description="A list of media objects like images and videos that can be referenced in the question.",
            default_factory=list,
        ),
    ]
    format: Annotated[
        TextFormat | None, Field(description="How to interpret textual strings.")
    ] = None
    weight: Annotated[
        float | None,
        Field(
            description="The weight of the question used to compute the final grade. "
            "The default value is 100. The weight is multiplied by the grade of the question to compute the final grade.\n"
        ),
    ] = 100
    grading: Annotated[
        Grading | None,
        Field(
            description="Describes how the question should be graded. "
            "Usually grades are represented as a percentage between 0 and 100. "
            "In order to award different points to different questions, use the weight field instead of tweaking this field.\n"
        ),
    ] = None
    shuffle: Annotated[
        bool | None,
        Field(
            description="Whether it is safe to shuffle the order of the choices in multiple-choice questions."
        ),
    ] = None

    INFO_FIELDS: ClassVar = [
        "id",
        "type",
        "comment",
        "media",
        "format",
        "grading",
        "shuffle",
    ]


class BaseProgrammingQuestion(BaseQuestion, ABC):
    """
    Common properties for programming questions.
    """

    supported_languages: Annotated[
        list[ProgrammingLanguage] | None | Literal["placeholder"],
        Field(
            alias="supported-languages",
            description="A list of programming languages that can be used in the question. "
            "The list is not exhaustive and can be extended by the user. "
            "Null represents all languages supported by the current platform. "
            '"placeholder" selects all languages with declared placeholders. '
            "If no placeholder is declared, this is equivalent to null.",
        ),
    ]
    placeholder: Annotated[
        dict[str, str],
        Field(
            description="A placeholder for the code snippet. It is used to display an initial structure to students.",
            examples=[
                {
                    "python": "def main():\n"
                    "    x = ... # your code here\n"
                    '    print("x =", x)'
                }
            ],
            default_factory=dict,
        ),
    ]
    answer_key: Annotated[
        Any,
        Field(
            alias="answer-key",
            description="Reference implementation used to grade the question. "
            "Each code snippet might be executed to compute the expected output from some given inputs. "
            "This field is a dictionary mapping programming languages with their corresponding code snippet.",
        ),
    ] = NOT_GIVEN
    timeout: Annotated[
        float | dict[str, float | None],
        Field(
            description="The maximum time in seconds that the answer key can run. If the answer key runs for more than this time, it is considered to be stuck and the execution is aborted.",
            default_factory=dict,
        ),
    ]
    compilation: Annotated[
        dict[str, Compilation],
        Field(
            description="A dictionary mapping programming languages with their corresponding compilation environments. The options vary on a per-language basis and are encoded as somewhat arbitrary JSON objects.\n",
            default_factory=dict,
        ),
    ]
    environment: Annotated[
        dict[str, Environment],
        Field(
            description="A dictionary mapping programming languages with their corresponding "
            "execution environment. The options vary on a per-language basis and are encoded as "
            'arbitrary JSON objects with a required "type" key. Each language is associated with a '
            "single environment. It is up to the execution environment interpret how the environment "
            "options affect how code is  executed.",
            default_factory=dict,
        ),
    ]
    linting: Annotated[
        dict[str, Linting],
        Field(
            description="A dictionary mapping programming languages with their corresponding linting options. Linting is executed on successful submissions and can discount points for style and poor practices.",
            default_factory=dict,
        ),
    ]
    forbidden_functions: Annotated[
        dict[str, list[str]],
        Field(
            alias="forbidden-functions",
            description="A list of fully qualified functions that cannot be used by the student.",
            default_factory=dict,
        ),
    ]
    forbidden_modules: Annotated[
        dict[str, list[str]],
        Field(
            alias="forbidden-modules",
            description="A list of fully qualified functions modules that cannot be used by the student.",
            default_factory=dict,
        ),
    ]
    forbidden_types: Annotated[
        dict[str, list[str]],
        Field(
            alias="forbidden-types",
            description="A list of fully qualified types or classes that cannot be used by the student.",
            default_factory=dict,
        ),
    ]
    forbidden_syntax: Annotated[
        dict[str, int],
        Field(
            alias="forbidden-syntax",
            description="A mapping of keywords (if, for, etc) with the maximum number of times they can  occur in the code.",
            default_factory=dict,
        ),
    ]

    INFO_FIELDS: ClassVar = [
        *BaseQuestion.INFO_FIELDS,
        "supported_languages",
        "timeout",
        "compilation",
        "environment",
        "linting",
        "forbidden_functions",
        "forbidden_types",
        "forbidden_syntax",
    ]


class MultipleChoice(BaseQuestion):
    """
    Multiple choice questions accept a single correct answer, which yields full grade.
    """

    type: Literal["multiple-choice"] = "multiple-choice"
    penalty: Annotated[float, Field(description="A penalty given to wrong answers")] = (
        0.0
    )
    choices: Annotated[
        list[Choice],
        Field(description="The list of choices for the question", min_items=2),
    ]
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS, "penalty"]


class MultipleSelection(BaseQuestion[TrueFalseGrading]):
    """
    Multiple selection questions display a list of choices and a full grade is
    given if the user computes all correct answers and none of the incorrect ones.
    """

    type: Literal["multiple-selection"] = "multiple-selection"
    choices: Annotated[
        list[Choice],
        Field(description="The list of choices for the question", min_items=2),
    ]
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS]



class TrueFalse(BaseQuestion[TrueFalseGrading]):
    """
    True-false questions display a list of choices in which the student should judge individually whether each one is true or false.

    """

    type: Literal["true-false"] = "true-false"
    choices: Annotated[
        list[Choice],
        Field(description="The list of choices for the question", min_items=2),
    ]
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS]



class Essay(BaseQuestion):
    """
    Essay questions display a text box where the user can write a long answer. The answer is graded manually.

    """

    type: Literal["essay"] = "essay"
    input: Annotated[
        InputType | ProgrammingLanguage | None,
        Field(
            description="The type of input field to be used for the essay.",
            examples=["text", "richtext", "python"],
        ),
    ] = InputType.RICHTEXT
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS, "input"]


class FillIn(BaseQuestion):
    """
    Fill-in-the-blank questions display a paragraph of text intercalated with
    input fields to representing blanks the user must fill-in.
    """

    type: Literal["fill-in"] = "fill-in"
    body: Annotated[
        list[FillInStatic | FillInSelection | FillInNumeric | FillInText],
        Field(
            description="The body of the question is formed by text snippets intercalated with "
            "input fields that represent blanks the user must fill in.",
            min_items=1,
        ),
    ]
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS]


class Associative(BaseQuestion):
    """
    Associative questions display a list of items and the user must associate
    each item with their corresponding answer.
    """

    type: Literal["associative"] = "associative"
    keys: Annotated[
        list[AssociativeKey] | None,
        Field(
            description="A list of objects representing the left hand side of the association.",
            min_length=1,
        ),
    ] = None
    values: Annotated[
        dict[str, AssociativeItemText | AssociativeItemImage] | None,
        Field(
            description="An object with items corresponding to the right hand side of each association. "
            "The  keys represent unique identifiers."
        ),
    ] = None
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS]


class CodeIo(BaseProgrammingQuestion):
    """
    A programming question that evaluates the result using by passing specific text inputs and  comparing it with the expected outputs displayed on the terminal.

    """

    type: Literal["code-io"] = "code-io"
    conf: Annotated[
        Conf | None,
        Field(
            description="A dictionary with configuration options for how the student respons will be matched with the answer key.\n"
        ),
    ] = None
    answer_key: Annotated[
        list[CodeIOExample | CodeIOInputs | CodeIOSpec],
        Field(
            alias="answer-key",
            description="An array of mechanisms to produce input and output examples.\n",
            min_items=1,
        ),
    ]
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS]


class UnitTest(BaseProgrammingQuestion):
    """
    A programming question that is evaluated running some unit tests.
    """

    type: Literal["unit-test"] = "unit-test"
    answer_key: Annotated[
        list[str],
        Field(
            alias="answer-key",
            description="An array of mechanisms to produce input and output examples.",
            min_items=1,
        ),
    ]
    INFO_FIELDS: ClassVar = [*BaseQuestion.INFO_FIELDS]

