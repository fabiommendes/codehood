"""
A simple Markdown-based format to declare questions for a LMS.
"""

import re
import os

from .parser import parse_question, parse_exam
from .questions import Question, QuestionType, Format, MultipleChoiceQuestion
from .exam import Exam

__version__ = "0.1"
__author__ = "Fábio Macêdo Mendes"
__all__ = [
    "parse_question",
    "parse_exam",
    "Question",
    "QuestionType",
    "Format",
    "MultipleChoiceQuestion",
    "Exam",
]

#: Global regular expression that matches valid slugs.
SLUG_PATTERN = re.compile(os.environ.get("MDQ_SLUG", r"[a-z0-9]+(?:[_-][a-z0-9]+)*"))
SLUG_INVALID_CHARS = set(".@")
SLUG_INVALID_WHITESPACE = set(" \t\n\f")

#: Name of recognized file extensions
MDQ_EXTENSIONS = (".mdq", ".mde", ".e.md", ".q.md", ".md")

del re, os
