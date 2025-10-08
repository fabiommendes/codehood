from .exam import Exam
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

type Question = (
    Associative
    | CodeIo
    | Essay
    | FillIn
    | MultipleChoice
    | MultipleSelection
    | TrueFalse
    | UnitTest
)


__all__ = [
    "Exam",
    "Question",
    "Associative",
    "CodeIo",
    "Essay",
    "FillIn",
    "MultipleChoice",
    "MultipleSelection",
    "TrueFalse",
    "UnitTest",
]
