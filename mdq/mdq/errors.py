from markdown_it.tree import SyntaxTreeNode as Node
from dataclasses import dataclass

class ParseError(ValueError):
    message: str


class EmptyQuestions(ParseError):
    message = "The exam contains no questions"


@dataclass
class NodesRemaining(ParseError):
    node: Node
    message: str = "There are unparsed nodes remaining"


@dataclass
class MissingField(ParseError):
    field: str
    message: str = "A required field is missing"


@dataclass
class IncompleteQuestion(ParseError):
    message: str = "Question ended before inferring its type"

