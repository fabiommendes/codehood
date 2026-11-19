"""
Tests for `codehood.push.assignment`: reading `assignments/<slug>.md` into the
payload of an assignment `PUT`. Pure: files in, values out.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from codehood.api import generated
from codehood.push.assignment import (
    AssignmentFile,
    InvalidAssignment,
    parse_size,
    scan_assignments,
)
from codehood.push.wire import assignment_payload

FULL = """---
title: Calculator lab
due: 2026-12-10T23:59:00-03:00
closes: 2026-12-12 23:59
opens: 2026-12-01
team:
  min: 2
  max: 3
  lock: 2026-12-05 12:00
template: lab-calc
restrictions:
  maxRepoBytes: 10mb
  maxFileBytes: 2048
  deny:
    - "*.exe"
  require:
    - README.md
---

# Calculator

Build a calculator.
"""


def write(root: Path, name: str, text: str) -> Path:
    path = root / "assignments" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def only(root: Path, repositories=("lab-calc",)):
    scan = scan_assignments(root, repositories)
    assert len(scan.items) == 1, scan
    return scan.items[0]


def invalid(root: Path, text: str, name: str = "lab.md", **kwargs) -> InvalidAssignment:
    write(root, name, text)
    item = only(root, **kwargs)
    assert isinstance(item, InvalidAssignment), item
    return item


def valid(root: Path, text: str, name: str = "lab.md") -> AssignmentFile:
    write(root, name, text)
    item = only(root)
    assert isinstance(item, AssignmentFile), item
    return item


def test_a_full_file_becomes_a_payload_with_every_field(tmp_path):
    item = valid(tmp_path, FULL, "calc.md")
    payload = assignment_payload(item)
    assert payload == {
        "slug": "calc",
        "title": "Calculator lab",
        "body": "# Calculator\n\nBuild a calculator.\n",
        "opensAt": "2026-12-01T00:00:00.000Z",
        "dueAt": "2026-12-11T02:59:00.000Z",
        "closesAt": "2026-12-12T23:59:00.000Z",
        "teamMin": 2,
        "teamMax": 3,
        "teamsLockAt": "2026-12-05T12:00:00.000Z",
        "template": "lab-calc",
        "restrictions": {
            "maxRepoBytes": 10 * 1024 * 1024,
            "maxFileBytes": 2048,
            "deny": ["*.exe"],
            "require": ["README.md"],
        },
        "checkpoints": [],
    }
    assert "---" not in payload["body"]


def test_defaults_are_individual_without_optional_fields(tmp_path):
    item = valid(tmp_path, "---\ntitle: T\ndue: 2026-12-10 18:00\n---\nText\n")
    assert assignment_payload(item) == {
        "slug": "lab",
        "title": "T",
        "body": "Text\n",
        "opensAt": None,
        "dueAt": "2026-12-10T18:00:00.000Z",
        "closesAt": None,
        "teamMin": 1,
        "teamMax": 1,
        "teamsLockAt": None,
        "template": None,
        "restrictions": None,
        "checkpoints": [],
    }


def test_a_team_with_only_min_has_max_equal_to_min(tmp_path):
    item = valid(
        tmp_path, "---\ntitle: T\ndue: 2026-12-10 18:00\nteam: { min: 2 }\n---\n"
    )
    assert (item.team_min, item.team_max) == (2, 2)


def test_underscore_files_other_files_and_folders_are_not_read(tmp_path):
    write(tmp_path, "real.md", "---\ntitle: T\ndue: 2026-12-10 18:00\n---\n")
    write(tmp_path, "_rascunho.md", "---\ntitle: Draft\n---\n")
    write(tmp_path, "notas.txt", "notes")
    write(tmp_path, "old/lab.md", "---\ntitle: Old\ndue: 2026-12-10 18:00\n---\n")
    scan = scan_assignments(tmp_path, ())
    assert [item.slug for item in scan.items] == ["real"]
    assert len(scan.warnings) == 1
    assert "assignments/old" in scan.warnings[0]


def test_no_assignments_folder_reads_nothing(tmp_path):
    scan = scan_assignments(tmp_path, ())
    assert scan.items == () and scan.warnings == ()


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-12-10T18:00:00-03:00", "2026-12-10T21:00:00.000Z"),
        ("2026-12-10T18:00:00Z", "2026-12-10T18:00:00.000Z"),
        ("2026-12-10 18:00", "2026-12-10T18:00:00.000Z"),
        ("2026-12-10 18:00:30", "2026-12-10T18:00:30.000Z"),
        ("2026-12-10T18:00", "2026-12-10T18:00:00.000Z"),
    ],
)
def test_dates_convert_as_exam_dates_do(tmp_path, text, expected):
    item = valid(tmp_path, f"---\ntitle: T\ndue: {text}\n---\n")
    assert assignment_payload(item)["dueAt"] == expected


def test_exam_start_and_due_agree_on_the_same_spelling(tmp_path):
    from datetime import datetime

    from codehood.push.exam import exam_scheduled_at

    item = valid(tmp_path, "---\ntitle: T\ndue: 2026-12-10T18:00:00-03:00\n---\n")
    expected = exam_scheduled_at(datetime.fromisoformat("2026-12-10T18:00:00-03:00"))
    assert assignment_payload(item)["dueAt"] == expected


@pytest.mark.parametrize("field", ["due", "closes", "team_lock"])
def test_a_date_without_time_is_refused_where_a_deadline_hides_in_it(tmp_path, field):
    fm = {
        "due": "title: T\ndue: 2026-12-20\n",
        "closes": "title: T\ndue: 2026-12-10 18:00\ncloses: 2026-12-20\n",
        "team_lock": "title: T\ndue: 2026-12-10 18:00\nteam: { lock: 2026-12-05 }\n",
    }[field]
    item = invalid(tmp_path, f"---\n{fm}---\n")
    name = "team.lock" if field == "team_lock" else field
    assert name in item.reason
    assert "time" in item.reason
    assert item.path.name == "lab.md"


def test_opens_accepts_a_date_without_time(tmp_path):
    item = valid(
        tmp_path, "---\ntitle: T\ndue: 2026-12-10 18:00\nopens: 2026-12-01\n---\n"
    )
    assert assignment_payload(item)["opensAt"] == "2026-12-01T00:00:00.000Z"


BASE_FM = "title: T\ndue: 2026-12-10 18:00\n"


CP = "checkpoints:\n  - { slug: p1, title: Parser, at: 2026-12-05 12:00 }\n"
CP_FM = BASE_FM + CP


@pytest.mark.parametrize(
    ("front", "field"),
    [
        ("title: T\ndue: not a date\n", "due"),
        (BASE_FM + "team: { min: 3, max: 2 }\n", "team"),
        (BASE_FM + "team: { max: 11 }\n", "team.max"),
        (BASE_FM + "team: { min: 0 }\n", "team.min"),
        (BASE_FM + "closes: 2026-12-09 18:00\n", "closes"),
        (BASE_FM + "opens: 2026-12-11 18:00\n", "opens"),
        (BASE_FM + "team: { lock: 2026-12-11 18:00 }\n", "team.lock"),
        (BASE_FM + "closses: 2026-12-12 18:00\n", "closses"),
        (BASE_FM + "team: { mn: 2 }\n", "team.mn"),
        (BASE_FM + "restrictions: { maxRepoByte: 1 }\n", "restrictions.maxRepoByte"),
        (
            BASE_FM + "restrictions: { maxRepoBytes: lots }\n",
            "restrictions.maxRepoBytes",
        ),
        ("title: T\n", "due"),
        (CP_FM + "  - { slug: p1, title: Again, at: 2026-12-07 12:00 }\n", "repeated"),
        (CP_FM.replace("12-05 12:00", "12-10 18:00"), "checkpoints[0].at"),
        (CP_FM.replace("12-05 12:00", "12-11 18:00"), "checkpoints[0].at"),
        (CP_FM.replace("12-05 12:00", "12-05"), "no time of day"),
        (BASE_FM + "opens: 2026-12-06 08:00\n" + CP, "is before opens"),
        (
            BASE_FM
            + "checkpoints:\n  - { slug: p1, title: A, at: 2026-12-05 12:00, note: x }\n",
            "checkpoints[0].note",
        ),
        (BASE_FM + "checkpoints:\n  - { title: A, at: 2026-12-05 12:00 }\n", "slug"),
        (BASE_FM + "checkpoints:\n  - { slug: p1, at: 2026-12-05 12:00 }\n", "title"),
        (BASE_FM + "checkpoints:\n  - { slug: p1, title: A }\n", "checkpoints[0].at"),
        (BASE_FM + "checkpoints: p1\n", "checkpoints"),
    ],
)
def test_a_file_with_a_local_error_names_the_field(tmp_path, front, field):
    item = invalid(tmp_path, f"---\n{front}---\n")
    assert item.slug == "lab"
    assert item.path == tmp_path / "assignments" / "lab.md"
    assert field in item.reason


def test_a_file_without_front_matter_is_refused(tmp_path):
    item = invalid(tmp_path, "Just text\n")
    assert "front matter" in item.reason


def test_a_bad_slug_in_the_file_name_is_refused(tmp_path):
    item = invalid(tmp_path, f"---\n{BASE_FM}---\n", name="Meu Trabalho.md")
    assert "slug" in item.reason


def test_a_template_must_be_a_repository_of_the_course(tmp_path):
    item = invalid(tmp_path, f"---\n{BASE_FM}template: nowhere\n---\n")
    assert "template" in item.reason and "nowhere" in item.reason


def test_a_template_with_underscore_is_refused(tmp_path):
    item = invalid(
        tmp_path,
        f"---\n{BASE_FM}template: _draft\n---\n",
        repositories=("_draft", "lab-calc"),
    )
    assert "template" in item.reason and "_" in item.reason


def test_the_payload_keys_are_those_of_the_generated_put(tmp_path):
    payload = assignment_payload(valid(tmp_path, FULL, "calc.md"))
    put = {
        field.alias or name
        for name, field in generated.AssignmentPut.model_fields.items()
    }
    assert set(payload) - {"slug"} == put - {"rev"}


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (1024, 1024),
        ("1024", 1024),
        ("10mb", 10 * 1024 * 1024),
        ("10 MB", 10 * 1024 * 1024),
        ("2kb", 2048),
        ("1gb", 1024**3),
        ("512b", 512),
    ],
)
def test_sizes_convert_to_bytes(text, expected):
    assert parse_size(text) == expected


@pytest.mark.parametrize(
    "text", ["lots", "-1", "0", "1.5.1mb", "mb", True, 1.5, "10xb", "1mib"]
)
def test_bad_sizes_are_refused(text):
    with pytest.raises(ValueError):
        parse_size(text)


def test_checkpoints_go_in_the_payload_as_given(tmp_path):
    item = valid(
        tmp_path,
        f"---\n{CP_FM}  - {{ slug: p2, title: Tests, at: 2026-12-08 12:00 }}\n---\n",
    )
    assert assignment_payload(item)["checkpoints"] == [
        {"slug": "p1", "title": "Parser", "at": "2026-12-05T12:00:00.000Z"},
        {"slug": "p2", "title": "Tests", "at": "2026-12-08T12:00:00.000Z"},
    ]
