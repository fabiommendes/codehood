from functools import cache
import random

from django.http import HttpRequest, HttpResponse, HttpResponseNotAllowed
from django.conf import settings

from .text import gettext_lazy as _
from . import markdown

MIME_TYPES = ["text/x-brainfuck", "text/plain", "text/html"]
BEVERAGES = getattr(
    settings,
    "CODEHOOD_TEAPOT_BEVERAGES",
    ["tea 🍵", "coffee ☕", "mate 🧉"],
)
MESSAGE = getattr(
    settings,
    "CODEHOOD_TEAPOT_MESSAGE",
    _("Let's brew some **{}** and code!"),
)


def teapot(beverage: str | None = None) -> str:
    """
    Return a teapot message for HTTP 418 and other easter-eggs.
    """
    if beverage is None:
        beverage = random.choice(BEVERAGES)
    return MESSAGE.format(beverage)


def teapot_view(request: HttpRequest) -> HttpResponse:
    """
    A view that returns a teapot message.
    """
    payload = teapot()
    match mime := request.get_preferred_type(MIME_TYPES):  # type: ignore
        case "text/x-brainfuck" | "application/x-brainfuck":
            payload = to_bf(payload)
        case "text/plain":
            ...
        case "text/html":
            payload = markdown.render(payload)
            payload = (
                "<style>body {background: black; color: #0F0; font-family: monospace; font-size: 2em;} </style>"
                + payload
            )
            payload = f"<main>{payload}</main>"
        case _:
            return HttpResponseNotAllowed(["GET"])
    return HttpResponse(payload, status=412, content_type=mime + "; charset=utf-8")


@cache
def to_bf(msg: str) -> str:
    return "\n".join((ord(c) * "+") + ".>" for c in msg)
