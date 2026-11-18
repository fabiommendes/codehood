"""
Tests for `codehood.push.exclude`: the slugs an `exclude` pattern protects.
"""

from __future__ import annotations

from pathlib import Path

from codehood.push.exclude import ExcludedFile, scan_excluded


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_an_excluded_question_protects_the_slug_its_id_declares(tmp_path: Path):
    _write(tmp_path, "questions/draft/herança.md", "---\nid: heranca\n---\nbroken\n")
    _write(tmp_path, "questions/draft/laços.md", "no front matter, not even mdq\n")
    excluded = sorted(scan_excluded(tmp_path, ["questions/draft/**"]), key=str)
    assert excluded == [
        ExcludedFile("question", "draft-lacos", "questions/draft/laços.md"),
        ExcludedFile("question", "heranca", "questions/draft/herança.md"),
    ]


def test_an_excluded_info_yaml_is_not_a_resource(tmp_path: Path):
    _write(tmp_path, "resources/w1/info.yaml", "a.png:\n  title: A\n")
    _write(tmp_path, "resources/w1/a.png", "png")
    excluded = list(scan_excluded(tmp_path, ["resources/w1/**"]))
    assert excluded == [ExcludedFile("resource", "w1-a.png", "resources/w1/a.png")]


def test_generated_artifacts_are_excluded_without_any_configuration(tmp_path: Path):
    from codehood.repo.file_tracker import scan_files

    _write(tmp_path, "resources/aula/exemplo.py", "x = 1\n")
    _write(tmp_path, "resources/aula/__pycache__/exemplo.cpython-312.pyc", "b")
    _write(tmp_path, "resources/elm/elm-stuff/0.19.1/d.dat", "b")
    _write(tmp_path, "resources/web/node_modules/a/index.js", "x")
    _write(tmp_path, "resources/web/lib.pyc", "b")
    flags = {f.name: f.excluded for f in scan_files(tmp_path) if f.type.name == "RESOURCE"}
    assert flags == {
        "aula/exemplo.py": False,
        "aula/__pycache__/exemplo.cpython-312.pyc": True,
        "elm/elm-stuff/0.19.1/d.dat": True,
        "web/node_modules/a/index.js": True,
        "web/lib.pyc": True,
    }


def test_user_patterns_add_to_the_default_exclusions(tmp_path: Path):
    from codehood.repo.file_tracker import scan_files

    _write(tmp_path, "resources/a/__pycache__/x.pyc", "b")
    _write(tmp_path, "resources/a/draft.md", "d")
    flags = {f.name: f.excluded for f in scan_files(tmp_path, ["resources/a/draft.md"]) if f.type.name == "RESOURCE"}
    assert flags == {"a/__pycache__/x.pyc": True, "a/draft.md": True}
