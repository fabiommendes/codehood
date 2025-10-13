import abc
from collections import deque
import io
from itertools import islice
from pathlib import Path
from typing import Any, Callable, Iterable, MutableMapping, TextIO

from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode as Node
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
from .types import NOT_GIVEN, NOT_GIVEN_TYPE, ItemMark
from .utils import humanize_slug, remove_extensions, slugify
from . import errors

QUESTION_TYPES: dict[QuestionType, type[Question]] = {
    "multiple-choice": models.MultipleChoice,
    "multiple-selection": models.MultipleSelection,
    "true-false": models.TrueFalse,
    "associative": models.Associative,
    "essay": models.Essay,
    "fill-in": models.FillIn,
}

type NodePredicate = Callable[[Node], bool] | None | dict[str, Any]


class EOFNode(Node):
    tag: str = "eof"
    type: str = "eof"
    content: str = ""

    def __bool__(self):
        return False


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
        src,
        deque(read_nodes(src)),
        default_id=default_id,
        default_title=default_title,
    )
    question = parser.parse()
    question.id = id or question.id
    question.title = title or question.title
    return question


def parse_exam(
    src: str | Path | TextIO,
    *,
    id: str | None = None,
    title: str | None = None,
    filename: str | Path | None = None,
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
        src,
        deque(read_nodes(src)),
        default_id=default_id,
        default_title=default_title,
    )
    exam = parser.parse()
    exam.id = id or exam.id
    exam.title = title or exam.title
    return exam


class Parser[T](abc.ABC, MutableMapping[str, Any]):
    def __init__(
        self,
        source: str,
        nodes: deque[Node],
        fullmatch: bool = True,
        default_id: str | None = None,
        default_title: str | None = None,
    ) -> None:
        self.source = source
        self.lines = source.splitlines()
        self.nodes = nodes
        self.default_id = default_id
        self.default_title = default_title
        self.fullmatch = fullmatch
        self._fields: dict[str, Any] = {}

    def __getitem__(self, key: str):
        return self._fields[key]

    def __setitem__(self, key: str, value: Any):
        self._fields[key] = value

    def __delitem__(self, key: str):
        del self._fields[key]

    def __iter__(self):
        return iter(self._fields)

    def __len__(self):
        return len(self._fields)

    def parse(self) -> T:
        self.root()
        if self.fullmatch and self.nodes:
            raise errors.NodesRemaining(self.nodes[0])
        return self.build()

    @abc.abstractmethod
    def root(self) -> None:
        raise NotImplementedError

    @abc.abstractmethod
    def build(self) -> T:
        raise NotImplementedError

    #
    # Utility methods
    def empty(self) -> bool:
        """
        Return true if node stream is empty
        """
        return not bool(self.nodes)

    def eof_node(self) -> Node:
        return Node(create_root=False)

    def peek(self) -> Node:
        """
        See next node, but do not advance
        """
        if self.nodes:
            return self.nodes[0]
        return self.eof_node()

    def pop_node(self) -> Node:
        return self.nodes.popleft()

    def push_node(self, node: Node):
        self.nodes.appendleft(node)

    def read(self) -> Node:
        """
        Read one node. Use .pop_node() if you want EOF errors on empty streams.
        """
        if self.nodes:
            return self.nodes.popleft()
        return self.eof_node()

    def expect(
        self, pred: NodePredicate = None, /, msg: str | None = None, **kwargs
    ) -> Node:
        """
        Expect a predicate to hold to the next node.
        """
        if tok := self.match(pred, **kwargs):
            return tok

        if msg is not None:
            raise ValueError(msg)

        node = self.peek()
        if callable(pred):
            msg = f"node {node.type} is not {pred.__name__}"

        expected = ", ".join(f"{k}={v!r}" for k, v in kwargs.items())
        actual = ", ".join(f"{k}={getattr(node, k)!r}" for k in kwargs)
        msg = f"Expected token with {expected}, got {actual}"
        raise ValueError(msg)

    def match(self, pred: NodePredicate = None, /, **kwargs) -> Node | None:
        """
        Verify if next node satisfy predicate and if so, consume it.
        """
        try:
            node = self.nodes[0]
        except IndexError:
            return None
        return self.nodes.popleft() if verify_node(node, pred, **kwargs) else None

    def take(self, pred: NodePredicate = None, **kwargs) -> Iterable[Node]:
        """
        Take all nodes that verify predicate.
        """
        while tok := self.match(pred, **kwargs):
            yield tok

    def take_until(self, pred: NodePredicate = None, **kwargs) -> Iterable[Node]:
        """
        Take nodes until the first one satisfy some prodicate
        """
        nodes = self.nodes
        while nodes and not verify_node(nodes[0], pred, **kwargs):
            yield nodes.popleft()

    def show(self, detail: bool = False, limit=None) -> None:
        nodes = iter(self.nodes)
        if limit is not None:
            nodes = islice(nodes, 0, limit)

        for node in nodes:
            print(node.pretty(show_text=True))
            if detail:
                print(vars(node))
        print("-----")

    def set(self, field: str, value: Any, force: bool = False) -> None:
        if force or field not in self._fields:
            self._fields[field] = value
        else:
            msg = f"Field '{field}' is already set to {self._fields[field]!r}"
            raise ValueError(msg)

    def original_source_block(self, node: Node):
        """
        Print the lines the node originally span in the source code
        """
        start = end = None
        for child in node.walk():
            if (pos := child.map) is None:
                continue
            a, b = pos
            if start is None:
                start = min(a, b)
            if end is None:
                end = max(a, b)
            end = max(end, a, b)

        if start is None or end is None:  # noqa: E711
            return ""

        if start == end:
            return self.lines[start]
        return "\n".join(self.lines[start:end])


class ExamParser(Parser[Exam]):
    def __init__(
        self,
        source: str,
        nodes: deque[Node],
        fullmatch: bool = True,
        default_id: str | None = None,
        default_title: str | None = None,
    ) -> None:
        super().__init__(source, nodes, fullmatch, default_id, default_title)
        self.body: list[Question] = []

    def build(self):
        if "id" not in self._fields:
            self._fields["id"] = self.default_id or "exam"
        if not self.body:
            raise errors.EmptyQuestions()
        return Exam(**self._fields, questions=self.body)

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
            self.metadata(info.content)
        if preamble := self.match(type="paragraph"):
            self.set("preamble", preamble.content)
        self.expect(tag="hr")

    def questions(self) -> None:
        while self.peek().tag != "hr":
            parser = QuestionParser(self.source, self.nodes, fullmatch=False)
            question = parser.parse()
            self.body.append(question)

    def epilogue(self) -> None:
        if self.match(type="hr") and (epilogue := self.match(type="paragraph")):
            self.set("epilogue", epilogue.content)

    def metadata(self, src: str) -> None:
        print(src)
        pass


class QuestionParser(Parser[Question]):
    def __init__(
        self,
        source: str,
        nodes: deque[Node],
        fullmatch: bool = True,
        default_id: str | None = None,
        default_title: str | None = None,
    ) -> None:
        super().__init__(source, nodes, fullmatch, default_id, default_title)
        self.type: QuestionType | NOT_GIVEN_TYPE = NOT_GIVEN

    def build(self) -> Question:
        return self.question_class()(**self._fields)

    def question_class(self) -> type[Question]:
        if self.type is NOT_GIVEN:
            raise errors.MissingField(
                "type", message="Could not determine question type"
            )
        return QUESTION_TYPES[self.type]

    #
    # Recursive descent parsing methods
    #
    def root(self) -> None:
        if title := self.match(tag="h2"):
            self.set("title", title.content)
        if info := self.match(type="code_block"):
            self.metadata(info.content)

        # We parse the body of the question
        paragraphs = []
        while (data := self.preamble_paragraph()) is not None:
            paragraphs.append(data)

        if paragraphs and "stem" not in self:
            self.set("stem", paragraphs.pop())
        self.set("preamble", "\n\n".join(paragraphs))

        self.show(True, 1)

    def preamble_paragraph(self) -> str | None:
        node = self.read()
        if self.type is NOT_GIVEN:
            return self._paragraph_or_set_type(node)
        raise NotImplementedError

    def metadata(self, src: str):
        print(f"Question info: {self['title']}")
        print(src)

    #
    # Auxiliary methods
    #
    def _paragraph_or_set_type(self, node: Node) -> str | None:
        match node.tag:
            case "eof":
                raise errors.IncompleteQuestion()
            case "ul":
                return self._paragraph_or_set_type_from_ul(node)
            case _:
                print(node.pretty())
                return node.content

    def _paragraph_or_set_type_from_ul(self, node: Node) -> str | None:
        kinds = set()
        for item in node.children:
            mark = self._item_mark(item)
            kinds.add(mark.kind)

        if kinds == {"select"}:
            self.type = "multiple-selection"
        elif kinds == {"true-false"}:
            self.type = "true-false"
        elif kinds == {"none"}:
            return self.original_source_block(node)
        elif kinds.issubset({"none", "select"}):
            self.type = "multiple-choice"
        return self.original_source_block(node)

    def _item_mark(self, node: Node) -> ItemMark:
        if not node.children:
            return None

        focus = first_child(node, type="paragraph")
        focus = first_child(focus, type="inline")
        if focus is None:
            return None

        return ItemMark.parse(focus.content)



def read_nodes(src: str) -> Iterable[Node]:
    tokens = md.parse(src)
    ast = Node(tokens)
    yield from ast.children


def verify_node(node: Node, pred: NodePredicate, **kwargs) -> bool:
    if not pred and not kwargs:
        raise TypeError(
            "must provide either a predicate function or keyword argument filters"
        )
    if pred is not None and kwargs:
        raise TypeError("cannot provide both predicate function and argument filters")

    if callable(pred):
        return pred(node)
    elif pred is not None:
        kwargs = pred

    if any(getattr(node, k) != v for k, v in kwargs.items()):
        return False

    return True


def first_child(node: Node | None, pred: NodePredicate = None, /, **kwargs) -> Node | None:
    """
    Verify if first child node satisfy predicate and if so return it.
    """
    if node is None:
        return None
    try:
        child = node.children[0]
    except IndexError:
        return None
    return child if verify_node(child, pred, **kwargs) else None

def take(self, pred: NodePredicate = None, **kwargs) -> Iterable[Node]:
    """
    Take all nodes that verify predicate.
    """
    while tok := self.match(pred, **kwargs):
        yield tok

def take_until(self, pred: NodePredicate = None, **kwargs) -> Iterable[Node]:
    """
    Take nodes until the first one satisfy some prodicate
    """
    nodes = self.nodes
    while nodes and not verify_node(nodes[0], pred, **kwargs):
        yield nodes.popleft()

