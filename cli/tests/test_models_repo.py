"""
Tests for `codehood_cli.models.repo.CourseIdentity` -- local validation of
`discipline`, `instructor`, and `edition` against the server's published
patterns. See `dev/specs/to-do/init.md`, "Slugs are validated locally".
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from codehood.models.repo import CourseIdentity

VALID = {"discipline": "cs101", "instructor": "ada", "edition": "2026-1"}

# One case per pattern violation in the spec's validation table, plus one
# reserved-slug case (`login`).
REJECTED = [
    ("discipline", "CS101"),  # DISCIPLINE_RE requires lowercase
    ("discipline", "login"),  # reserved slug
    ("discipline", "-x"),  # DISCIPLINE_RE requires starting with a letter
    ("instructor", "ada_b"),  # USERNAME_RE excludes underscore
    ("edition", "2026_1"),  # EDITION_RE requires a hyphen, not underscore
    ("edition", "2026-01"),  # EDITION_RE forbids a leading zero on the term
]


@pytest.mark.parametrize("field,value", REJECTED)
def test_rejects_invalid_slug(field: str, value: str) -> None:
    kwargs = dict(VALID)
    kwargs[field] = value
    with pytest.raises(ValidationError) as exc_info:
        CourseIdentity(**kwargs)
    assert field in str(exc_info.value)


def test_accepts_valid_identity() -> None:
    identity = CourseIdentity(**VALID)
    assert identity.discipline == "cs101"
    assert identity.instructor == "ada"
    assert identity.edition == "2026-1"
