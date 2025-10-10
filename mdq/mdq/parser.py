import abc
from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from itertools import islice
from pathlib import Path
from typing import Any, Iterable, TextIO

from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode
from mdit_py_plugins.amsmath import amsmath_plugin
from mdit_py_plugins.container import container_plugin
from mdit_py_plugins.deflist import deflist_plugin
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.footnote import footnote_plugin
from mdit_py_plugins.subscript import sub_plugin

from . import models

# from mdit_py_plugins.anchors import anchors_plugin
# from mdit_py_plugins.tasklists import tasklists_plugin
from .models import Exam, Question, QuestionType
from .types import NOT_GIVEN, NOT_GIVEN_TYPE
from .utils import humanize_slug, remove_extensions, slugify

QUESTION_TYPES: dict[QuestionType, type[Question]] = {
    "multiple-choice": models.MultipleChoice,
    "multiple-selection": models.MultipleSelection,
    "true-false": models.TrueFalse,
    "associative": models.Associative,
    "essay": models.Essay,
    "fill-in": models.FillIn,
}


class ParserErrorCode(StrEnum):
    EMTPY_QUESTIONS = "empty-questions"
    EOF = "eof"
    MISSING_FIELD = "missing-field"


class ParseError(ValueError):
    message: str
    code: ParserErrorCode


class EmptyQuestions(ParseError):
    message = "The exam contains no questions"
    code: ParserErrorCode = ParserErrorCode.EMTPY_QUESTIONS


@dataclass
class NodesRemaining(ParseError):
    node: SyntaxTreeNode
    message: str = "There are unparsed nodes remaining"
    code: ParserErrorCode = ParserErrorCode.EOF


@dataclass
class MissingField(ParseError):
    field: str
    message: str = "A required field is missing"
    code: ParserErrorCode = ParserErrorCode.MISSING_FIELD


md = (
    (
        MarkdownIt("commonmark", {"breaks": True, "html": True})
        .use(footnote_plugin)
        .use(amsmath_plugin)
        .use(deflist_plugin)
        .use(dollarmath_plugin)
        .use(container_plugin, "info")
        .use(sub_plugin)
        # .use(tasklists_plugin, {"label": True})
        # .use(anchors_plugin)
    )
    .enable("table")
    .enable("strikethrough")
)


def parse_question(
    src: str | TextIO | Path,
    *,
    id: str | None = None,
    title: str | None = None,
    filename: str | Path | None = None,
) -> Question:
    # Normalize file name
    if isinstance(src, Path) and filename is not None:
        raise ValueError("Cannot specify filename when src is a Path")

    if filename is None and isinstance(src, Path):
        filename = src
    elif filename is None and hasattr(src, "name"):
        filename = getattr(src, "name", None)

    if isinstance(filename, str):
        filename = Path(filename).name
    elif isinstance(filename, Path):
        filename = filename.name

    # Normalize id
    default_id = None
    if id is None and filename is not None:
        default_id = slugify(remove_extensions(Path(filename).name))
    elif id is None and title is not None:
        default_id = slugify(title)

    # Normalize title
    default_title = None
    if title is None and id is not None:
        default_title = humanize_slug(id, title=True)

    # Normalize source
    if isinstance(src, Path):
        src = src.read_text(encoding="utf-8")
    elif not isinstance(src, str):
        src = src.read()

    parser = QuestionParser(
        deque(read_nodes(src)),
        default_id=default_id,
        default_title=default_title,
    )
    question = parser.parse()
    question.id = id or question.id
    question.title = title or question.title
    return question


def parse_exam(
    src: str | TextIO,
    *,
    id: str | None = None,
    title: str | None = None,
    filename: str | None = None,
) -> Exam:
    # Normalize file name
    if isinstance(src, Path) and filename is not None:
        raise ValueError("Cannot specify filename when src is a Path")

    if filename is None and isinstance(src, Path):
        filename = src
    elif filename is None and hasattr(src, "name"):
        filename = getattr(src, "name", None)

    if isinstance(filename, str):
        filename = Path(filename).name
    elif isinstance(filename, Path):
        filename = filename.name

    # Normalize id
    default_id = None
    if id is None and filename is not None:
        default_id = slugify(remove_extensions(Path(filename).name))
    elif id is None and title is not None:
        default_id = slugify(title)

    # Normalize title
    default_title = None
    if title is None and id is not None:
        default_title = humanize_slug(id, title=True)

    # Normalize source
    if isinstance(src, Path):
        src = src.read_text(encoding="utf-8")
    elif not isinstance(src, str):
        src = src.read()

    parser = ExamParser(
        deque(read_nodes(src)),
        default_id=default_id,
        default_title=default_title,
    )
    exam = parser.parse()
    exam.id = id or exam.id
    exam.title = title or exam.title
    return exam


class Parser[T](abc.ABC):
    def __init__(
        self,
        nodes: deque[SyntaxTreeNode],
        fullmatch: bool = True,
        default_id: str | None = None,
        default_title: str | None = None,
    ) -> None:
        self.nodes = nodes
        self.default_id = default_id
        self.default_title = default_title
        self.fullmatch = fullmatch
        self.fields: dict[str, Any] = {}

    def parse(self) -> T:
        self.root()
        if self.fullmatch and self.nodes:
            raise NodesRemaining(self.nodes[0])
        return self.build()

    @abc.abstractmethod
    def root(self) -> None:
        raise NotImplementedError

    @abc.abstractmethod
    def build(self) -> T:
        raise NotImplementedError

    #
    # Utility methods
    #
    def eof_node(self) -> SyntaxTreeNode:
        return SyntaxTreeNode(create_root=False)

    def peek(self) -> SyntaxTreeNode:
        if self.nodes:
            return self.nodes[0]
        return self.eof_node()

    def read(self) -> SyntaxTreeNode:
        if self.nodes:
            return self.nodes.popleft()
        return self.eof_node()

    def expect(self, **kwargs) -> SyntaxTreeNode:
        if tok := self.match(**kwargs):
            return tok

        expected = ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
        actual = ", ".join(f"{k}={getattr(self.peek(), k)!r}" for k in kwargs)
        msg = f"Expected token with {expected}, got {actual}"
        raise ValueError(msg)

    def match(self, **kwargs) -> SyntaxTreeNode | None:
        tok = self.peek()
        for k, v in kwargs.items():
            if getattr(tok, k) != v:
                return None
        return self.read()

    def show(self, detail: bool = False, limit=None) -> None:
        nodes = self.nodes
        if limit is not None:
            nodes = islice(nodes, 0, limit)

        for node in nodes:
            print(node.pretty(show_text=True))
            if detail:
                print(vars(node))
        print("-----")

    def set(self, field: str, value: Any, force: bool = False) -> None:
        if force or field not in self.fields:
            self.fields[field] = value
        else:
            msg = f"Field '{field}' is already set to {self.fields[field]!r}"
            raise ValueError(msg)


class ExamParser(Parser[Exam]):
    def __init__(
        self,
        nodes: deque[SyntaxTreeNode],
        fullmatch: bool = True,
        default_id: str | None = None,
        default_title: str | None = None,
    ) -> None:
        super().__init__(nodes, fullmatch, default_id, default_title)
        self.body = []

    def build(self):
        if "id" not in self.fields:
            self.fields["id"] = self.default_id or "exam"
        if not self.body:
            raise EmptyQuestions()
        return Exam(**self.fields, questions=self.body)

    def root(self) -> None:
        self.info()
        self.questions()
        self.epilogue()

        for node in self.nodes:
            print(node.pretty(show_text=True))
        self.nodes.clear()

    #
    # Recursive descent parsing methods
    #
    def info(self) -> None:
        if title := self.match(tag="h1"):
            self.set("title", title.content)
        if subtitle := self.match(tag="h2"):
            self.set("description", subtitle.content)
        if info := self.match(type="code_block"):
            self.parse_info(info.content)
        if preamble := self.match(type="paragraph"):
            self.set("preamble", preamble.content)
        self.expect(tag="hr")

    def questions(self) -> None:
        while self.peek().tag != "hr":
            parser = QuestionParser(self.nodes, fullmatch=False)
            question = parser.parse()
            self.body.append(question)

    def epilogue(self) -> None:
        if self.match(type="hr") and (epilogue := self.match(type="paragraph")):
            self.set("epilogue", epilogue.content)

    def parse_info(self, src: str) -> None:
        print(src)
        pass


class QuestionParser(Parser[Question]):
    def __init__(
        self,
        nodes: deque[SyntaxTreeNode],
        fullmatch: bool = True,
        default_id: str | None = None,
        default_title: str | None = None,
    ) -> None:
        super().__init__(nodes, fullmatch, default_id, default_title)
        self.type: QuestionType | NOT_GIVEN_TYPE = NOT_GIVEN

    def build(self) -> Question:
        return self.question_class()(**self.fields)

    def question_class(self) -> type[Question]:
        if self.type is NOT_GIVEN:
            raise MissingField("type", message="Could not determine question type")
        return QUESTION_TYPES[self.type]

    #
    # Recursive descent parsing methods
    #
    def root(self) -> None:
        pass


def read_nodes(src: str) -> Iterable[SyntaxTreeNode]:
    tokens = md.parse(src)
    ast = SyntaxTreeNode(tokens)
    yield from ast.children
