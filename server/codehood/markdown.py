from typing import Any
from markdown_it import MarkdownIt
from mdit_py_plugins.front_matter import front_matter_plugin
from mdit_py_plugins.footnote import footnote_plugin
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.amsmath import amsmath_plugin

md = (
    MarkdownIt("commonmark", {"breaks": True, "html": True})
    .use(front_matter_plugin)
    .use(footnote_plugin)
    .use(dollarmath_plugin)
    .use(amsmath_plugin)
    .enable("table")
)


def render(text: str, env: dict[str, Any] | None = None) -> str:
    """
    Render the given text using MarkdownIt.
    """
    return md.render(text, env)
