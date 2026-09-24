"""
Tests for the example question and exam `init` writes -- see
`dev/specs/to-do/init.md`, "Examples are real MDQ, not placeholders".

The `mdq` package is not a dependency of this project (see the spec's
scope), so this does not run the real MDQ parser. It checks what `init`
controls directly: the frontmatter is valid YAML, the question's id (its
filename stem, since it sets none in frontmatter) matches MDQ's id
pattern, and the exam's `include:` resolves to that id. A real MDQ parse
of these files is `push`'s job.
"""

from __future__ import annotations

import re

import yaml

from codehood.repo import EXAMPLE_ID, write_repo

ID_PATTERN = re.compile(r"^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$")


def _leading_frontmatter(text: str) -> dict:
    """
    Parse the first `---`-fenced block at the top of an MDQ document.
    """
    lines = text.splitlines()
    assert lines[0].strip() == "---", "document must open with a frontmatter fence"
    end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    return yaml.safe_load("\n".join(lines[1:end])) or {}


def test_example_question_and_exam_are_valid_mdq(tmp_path, identity, server):
    write_repo(tmp_path, identity, server)

    question_text = (tmp_path / "questions" / "example.md").read_text(encoding="utf-8")
    exam_text = (tmp_path / "exams" / "example.md").read_text(encoding="utf-8")

    question_frontmatter = _leading_frontmatter(question_text)
    assert isinstance(question_frontmatter, dict)
    assert "id" not in question_frontmatter
    assert ID_PATTERN.fullmatch(EXAMPLE_ID)

    exam_frontmatter = _leading_frontmatter(exam_text)
    assert isinstance(exam_frontmatter, dict)
    assert exam_frontmatter["course"] == identity.discipline

    include_match = re.search(r"^include:\s*(\S+)\s*$", exam_text, re.MULTILINE)
    assert include_match is not None
    assert include_match.group(1) == EXAMPLE_ID
