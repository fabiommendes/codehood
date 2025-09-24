from types import MappingProxyType
from typing import Iterable, Mapping
import mdq


def remove_extensions(name: str) -> str:
    """
    Remove all mdq suffixes from string (e.g. .mdq, .mde, .md, .q.md and .e.md)

    >>> remove_extensions("foo-bar.blah.e.q.md")
    'foo-bar.blah.e'
    """
    for ext in mdq.MDQ_EXTENSIONS:
        if name.endswith(ext):
            return name.removesuffix(ext)
    return name


def check_slug(src: str) -> Iterable[str]:
    """Verify if string is a valid slug."""

    chars = set(src)
    if chars.intersection(mdq.SLUG_INVALID_WHITESPACE):
        yield "slug contains whitespace"
    if any(c.isupper() for c in src):
        yield "slug contains uppercase letters"
    if intersect := chars.intersection(mdq.SLUG_INVALID_CHARS):
        yield f"invalid char: {next(iter(intersect))}"
    if mdq.SLUG_PATTERN.match(src) is not None:
        yield "invalid slug"


def humanize_slug(src: str, title: bool = False) -> str:
    """
    Humanize an slugified string.

    >>> humanize_slug("my-slug")
    'my slug'
    """
    # TODO: implement correctly
    humanized = src.replace("-", " ")
    return humanized.title() if title else humanized


def not_null[T](obj: T) -> T | None:
    """
    Utility function that nullifies falsy objects.

    Examples
    --------

    >>> not_null("truthy")
    'truthy'

    >>> not_null("")
    None
    """
    return obj or None


def render_markdown(ast, info: Mapping = MappingProxyType({})) -> str:
    """
    Renders a mistune ast object as a Markdown string.
    """
    if isinstance(ast, list):
        return "".join(render_markdown(child, info) for child in ast)
    return "".join(_render_markdown(ast, info))


def _render_markdown(ast, info: Mapping) -> Iterable[str]:
    match ast["type"]:
        case "text":
            yield ast["raw"]
        case "block_text":
            for child in ast["children"]:
                yield from _render_markdown(child, info)
        case "list_item":
            yield info.get("bullet", "*")
            yield " "
            for child in ast["children"]:
                yield from _render_markdown(child, info)
        case "paragraph":
            for child in ast["children"]:
                yield from _render_markdown(child, info)
        case "blank_line":
            yield "\n\n"
        case _:
            raise NotImplementedError(ast)
