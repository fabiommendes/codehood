from decimal import Decimal
from types import MappingProxyType
from typing import TypeVar, Any, TextIO
from pathlib import Path

import mistune
import mistune.renderers
import mistune.renderers.markdown
from slugify import slugify

from .utils import humanize_slug, remove_extensions, render_markdown
from .questions import MultipleChoiceQuestion, Question
from .questions import multiple_choice
from .exam import Exam

T = TypeVar("T")


md_parser = mistune.create_markdown(
    renderer="ast",
    plugins=[
        "strikethrough",
        "footnotes",
        "table",
        "url",
        "task_lists",
        "def_list",
        "math",
        "spoiler",
    ],
)
md_renderer = mistune.renderers.markdown.MarkdownRenderer()


class QuestionParser:
    ast: list[dict[str, Any]]
    src: str
    state: mistune.BlockState

    def __init__(self, src: str):
        self.src = src
        ast, self.state = md_parser.parse(self.src)
        if isinstance(ast, str):
            raise ValueError(f"invalid source: {str!r}")
        self.ast = ast

    def parse(self) -> Question:
        if self.is_multiple_choice():
            return self.parse_multiple_choice()
        else:
            raise ValueError("Could not recognize question type.")

    def is_multiple_choice(self):
        return True

    def parse_multiple_choice(self) -> MultipleChoiceQuestion:
        if isinstance(self.ast, str):
            raise ValueError("invalid multiple choice document")

        choices: list[multiple_choice.Choice] = []
        while self.ast and self.ast[-1]["type"] == "list":
            items = self.ast.pop()
            choices = self.parse_multiple_choice_items(items) + choices

        title, slug, meta = self.parse_consume_title_slug_meta()
        description = self.consume_to_markdown()
        is_ordered = meta.pop("is_ordered", False)

        return MultipleChoiceQuestion(
            title=title,
            slug=slug,
            meta=meta,
            description=description,
            choices=choices,
            is_ordered=is_ordered,
        )

    def parse_multiple_choice_items(self, items: dict) -> list[multiple_choice.Choice]:
        default_value = Decimal(1 if items["bullet"] == "*" else 0)

        def parse(choice):
            feedback = ""
            description = render_markdown(choice["children"])
            return multiple_choice.Choice(
                value=default_value, text=description, feedback=feedback
            )

        return [parse(choice) for choice in items["children"]]

    def parse_consume_title_slug_meta(self):
        title = ""
        meta = {}
        slug = ""

        if self.ast[0]["type"] == "header":
            ...

        if self.ast[0]["type"] == "block":
            ...

        if self.ast[0]["children"][0]["type"] == "block":
            ...

        return title, slug, meta

    def consume_to_markdown(self, info=MappingProxyType({})) -> str:
        md = [render_markdown(block, info) for block in self.ast]
        self.ast.clear()
        return "".join(md)


def parse_question(
    src: str | TextIO,
    *,
    slug: str | None = None,
    title: str | None = None,
    filename: str | Path | None = None,
) -> Question:

    if not isinstance(src, str):
        if filename is None:
            filename = getattr(src, "name", None)
        with src:
            src = src.read()

    parser = QuestionParser(src)
    question = parser.parse()

    # Infer slug and title from filename
    if slug is None and filename is not None:
        slug = slugify(remove_extensions(Path(filename).name))
    if title is None and filename is not None:
        title = remove_extensions(Path(filename).name).replace("-", " ").title()
    if title is not None:
        question.title = title
    if slug is not None:
        question.slug = slug
    if not question.title and question.slug:
        question.title = humanize_slug(question.slug)

    return question


def parse_exam(
    src: str | TextIO,
    *,
    slug: str | None = None,
    title: str | None = None,
    filename: str | None = None,
) -> Exam:
    raise NotImplementedError
