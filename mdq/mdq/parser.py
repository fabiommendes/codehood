from pathlib import Path
from typing import TextIO

import rich
import rich.pretty
from markdown_it import MarkdownIt
from markdown_it.tree import SyntaxTreeNode
from mdit_py_plugins.amsmath import amsmath_plugin
from mdit_py_plugins.container import container_plugin
from mdit_py_plugins.deflist import deflist_plugin
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.footnote import footnote_plugin
from mdit_py_plugins.subscript import sub_plugin

# from mdit_py_plugins.anchors import anchors_plugin
# from mdit_py_plugins.tasklists import tasklists_plugin
from .models import Exam, Question
from .utils import humanize_slug, remove_extensions, slugify

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
    if isinstance(src, Path):
        filename = str(src)
        src = src.read_text(encoding="utf-8")
    elif not isinstance(src, str):
        if filename is None:
            filename = getattr(src, "name", None)
        with src:
            src = src.read()

    parser = QuestionParser(src)
    question = parser.parse()

    # Infer slug and title from filename
    if id is None and filename is not None:
        id = slugify(remove_extensions(Path(filename).name))
    if title is None and filename is not None:
        title = remove_extensions(Path(filename).name).replace("-", " ").title()
    if title is not None:
        question.title = title
    if id is not None:
        question.id = id
    if not question.title and question.id:
        question.title = humanize_slug(question.id)

    return question


def parse_exam(
    src: str | TextIO,
    *,
    id: str | None = None,
    title: str | None = None,
    filename: str | None = None,
) -> Exam:
    raise NotImplementedError


class QuestionParser:
    def __init__(self, src: str) -> None:
        self.src = src
        self.tokens = md.parse(src)
        self.ast = SyntaxTreeNode(self.tokens)

    def parse(self) -> Question:
        print(self.ast.pretty(indent=2, show_text=True))
        rich.pretty.pprint(self.ast)
        rich.pretty.pprint(self.ast)
        exit()
