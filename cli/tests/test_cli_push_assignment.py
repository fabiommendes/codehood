"""
`codehood push` and `assignments/`: the order of the writes, the three-way
sync with `rev`, and the deletion of an assignment that has teams. The server
is `FakeCourseServer`.
"""

from __future__ import annotations

import importlib
import json

import pytest
from fake_course_server import BASE, FakeCourseServer, team_json
from test_cli_push import CALENDAR_MD, SERVER, TOML, _install_transport
from typer.testing import CliRunner

from codehood.api import base as base_module
from codehood.api import generated
from codehood.cli.base import app

push_module = importlib.import_module("codehood.cli.push")
runner = CliRunner()

ASSIGNMENT = f"{BASE}/assignment"

PUT_KEYS = {
    field.alias or name for name, field in generated.AssignmentPut.model_fields.items()
}


@pytest.fixture(autouse=True)
def credentials_path(tmp_path_factory, monkeypatch):
    store = tmp_path_factory.mktemp("credentials") / "credentials.toml"
    monkeypatch.setattr(base_module, "CREDENTIALS_PATH", store)
    base_module.save_token(SERVER, "test-token")


@pytest.fixture
def course(tmp_path):
    (tmp_path / "codehood.toml").write_text(TOML, encoding="utf-8")
    (tmp_path / "README.md").write_text("# CS101\n\nA description.\n", encoding="utf-8")
    (tmp_path / "calendar.md").write_text(CALENDAR_MD, encoding="utf-8")
    return tmp_path


def write_assignment(
    course, slug="lab", *, front="", body="Do it.\n", due="2026-12-10 18:00"
):
    path = course / "assignments" / f"{slug}.md"
    path.parent.mkdir(exist_ok=True)
    path.write_text(
        f"---\ntitle: Lab\ndue: {due}\n{front}---\n\n{body}", encoding="utf-8"
    )
    return path


def push(course, monkeypatch, server, *args, input=None):
    _install_transport(monkeypatch, server.transport())
    return runner.invoke(app, ["push", str(course), *args], input=input)


def assignment_writes(server, method=None):
    return [
        r
        for r in server.requests
        if r.url.path.startswith(ASSIGNMENT)
        and r.method != "GET"
        and (method is None or r.method == method)
    ]


def stored_base(course) -> dict:
    path = course / ".local" / "codehood" / "base" / "assignments.json"
    return json.loads(path.read_text(encoding="utf-8"))["entries"]


def terminal(monkeypatch, answer: bool | None):
    """
    Make the push believe it runs at a terminal, or not.
    """
    monkeypatch.setattr(push_module, "is_interactive", lambda: answer is not None)


def test_an_assignment_file_is_pushed_with_every_field(course, monkeypatch):
    write_assignment(
        course, front="closes: 2026-12-12 18:00\nteam: { min: 2, max: 3 }\n"
    )
    server = FakeCourseServer()
    result = push(course, monkeypatch, server)
    assert result.exit_code == 0, result.output
    assert "assignment lab" in result.output
    stored = server.assignments["lab"]
    assert stored["title"] == "Lab"
    assert stored["body"] == "Do it.\n"
    assert (stored["teamMin"], stored["teamMax"]) == (2, 3)
    assert stored["closesAt"] == "2026-12-12T18:00:00.000Z"


def test_the_put_sends_exactly_the_keys_of_the_generated_body(course, monkeypatch):
    write_assignment(course)
    server = FakeCourseServer()
    push(course, monkeypatch, server)
    (put,) = assignment_writes(server, "PUT")
    assert set(json.loads(put.content)) == PUT_KEYS
    assert "dueAt" in json.loads(put.content)
    assert put.headers["If-None-Match"] == "*"


def test_a_repository_is_committed_before_the_assignment_that_uses_it(
    course, monkeypatch
):
    (course / "repositories" / "lab-calc").mkdir(parents=True)
    (course / "repositories" / "lab-calc" / "main.py").write_text("print(1)\n")
    write_assignment(course, front="template: lab-calc\n")
    server = FakeCourseServer()
    result = push(course, monkeypatch, server)
    assert result.exit_code == 0, result.output
    writes = server.writes
    repository = writes.index(("PUT", f"{BASE}/repository"))
    commit = writes.index(("POST", f"{BASE}/repository/lab-calc/commit"))
    assignment = writes.index(("PUT", f"{ASSIGNMENT}/lab"))
    assert repository < commit < assignment
    assert server.assignments["lab"]["template"] == "lab-calc"


def test_a_second_push_writes_nothing_and_a_changed_body_goes_with_if_match(
    course, monkeypatch
):
    write_assignment(course)
    server = FakeCourseServer()
    assert push(course, monkeypatch, server).exit_code == 0
    first = server.assignments["lab"]["updatedAt"]
    assert stored_base(course)["lab"]["rev"] == server.assignments["lab"]["rev"]

    server.requests.clear()
    assert push(course, monkeypatch, server).exit_code == 0
    assert assignment_writes(server) == []

    write_assignment(course, body="Do it better.\n")
    result = push(course, monkeypatch, server)
    assert result.exit_code == 0, result.output
    (put,) = assignment_writes(server)
    assert put.method == "PUT"
    assert put.headers["If-Match"] == f'"{first}"'
    assert "If-None-Match" not in put.headers
    assert server.assignments["lab"]["body"] == "Do it better.\n"


def test_a_removed_date_is_sent_as_null(course, monkeypatch):
    write_assignment(course, front="closes: 2026-12-12 18:00\n")
    server = FakeCourseServer()
    push(course, monkeypatch, server)
    write_assignment(course)
    assert push(course, monkeypatch, server).exit_code == 0
    assert server.assignments["lab"]["closesAt"] is None


def test_underscore_files_and_other_files_are_not_pushed(course, monkeypatch):
    write_assignment(course)
    write_assignment(course, "_rascunho")
    (course / "assignments" / "notas.txt").write_text("notes")
    (course / "assignments" / "old").mkdir()
    (course / "assignments" / "old" / "lab.md").write_text("---\ntitle: x\n---\n")
    server = FakeCourseServer()
    result = push(course, monkeypatch, server)
    assert result.exit_code == 0, result.output
    assert list(server.assignments) == ["lab"]
    assert "assignments/old" in result.output


def test_an_invalid_file_is_not_pushed_and_the_others_are(course, monkeypatch):
    write_assignment(course, "broken", front="closses: 2026-12-12 18:00\n")
    write_assignment(course, "fine")
    server = FakeCourseServer()
    result = push(course, monkeypatch, server)
    assert result.exit_code == 1
    assert list(server.assignments) == ["fine"]
    line = next(x for x in result.output.splitlines() if "broken" in x)
    assert "broken.md" in line and "closses" in line
    assert not any(r.url.path.endswith("/broken") for r in server.requests)


def test_an_assignment_with_a_template_that_is_not_a_repository_is_not_pushed(
    course, monkeypatch
):
    write_assignment(course, front="template: nowhere\n")
    server = FakeCourseServer()
    result = push(course, monkeypatch, server)
    assert result.exit_code == 1
    assert "template" in result.output and server.assignments == {}


def test_a_dry_run_plans_the_assignment_and_writes_nothing(course, monkeypatch):
    write_assignment(course)
    server = FakeCourseServer()
    result = push(course, monkeypatch, server, "--dry-run")
    assert result.exit_code == 0, result.output
    assert "planned  assignment lab" in result.output
    assert server.writes == []


#
# Deleting
#
def pushed(course, monkeypatch, *, teams=()):
    write_assignment(course)
    server = FakeCourseServer()
    assert push(course, monkeypatch, server).exit_code == 0
    server.teams["lab"] = list(teams)
    (course / "assignments" / "lab.md").unlink()
    server.requests.clear()
    return server


def test_an_assignment_gone_from_disk_is_kept_with_a_warning(course, monkeypatch):
    server = pushed(course, monkeypatch)
    result = push(course, monkeypatch, server)
    assert result.exit_code == 0, result.output
    assert "assignment lab kept" in result.output
    assert "--drop-assignments" in result.output
    assert assignment_writes(server) == []
    assert "lab" in server.assignments


def test_drop_assignments_deletes_one_without_teams_without_force(course, monkeypatch):
    server = pushed(course, monkeypatch)
    result = push(course, monkeypatch, server, "--drop-assignments")
    assert result.exit_code == 0, result.output
    (delete,) = assignment_writes(server, "DELETE")
    assert "force" not in delete.url.params
    assert "lab" not in server.assignments
    assert "lab" not in stored_base(course)


def test_a_confirmed_delete_of_an_assignment_with_teams_forces_it(course, monkeypatch):
    server = pushed(
        course,
        monkeypatch,
        teams=[team_json("t1", "A", ["bob"]), team_json("t2", "B", ["eve"])],
    )
    terminal(monkeypatch, True)
    result = push(course, monkeypatch, server, "--drop-assignments", input="y\n")
    assert result.exit_code == 0, result.output
    assert "2 team(s)" in result.output
    first, second = assignment_writes(server, "DELETE")
    assert "force" not in first.url.params
    assert second.url.params["force"] == "true"
    assert "lab" not in server.assignments
    assert "lab" not in stored_base(course)


@pytest.mark.parametrize("answer", ["n\n", "\n"])
def test_a_refused_delete_keeps_the_assignment(course, monkeypatch, answer):
    server = pushed(course, monkeypatch, teams=[team_json("t1", "A", ["bob"])])
    terminal(monkeypatch, True)
    result = push(course, monkeypatch, server, "--drop-assignments", input=answer)
    assert result.exit_code == 0, result.output
    assert all("force" not in r.url.params for r in assignment_writes(server, "DELETE"))
    assert "lab" in server.assignments
    assert "kept" in result.output
    assert "lab" in stored_base(course)


def test_without_a_terminal_a_delete_with_teams_is_never_forced(course, monkeypatch):
    server = pushed(course, monkeypatch, teams=[team_json("t1", "A", ["bob"])])
    terminal(monkeypatch, None)
    result = push(course, monkeypatch, server, "--drop-assignments", input="y\n")
    assert result.exit_code == 0, result.output
    assert all("force" not in r.url.params for r in assignment_writes(server, "DELETE"))
    assert "lab" in server.assignments
    assert "1 team(s)" in result.output


def test_an_invalid_file_does_not_let_drop_assignments_delete_the_server_copy(
    course, monkeypatch
):
    write_assignment(course)
    server = FakeCourseServer()
    assert push(course, monkeypatch, server).exit_code == 0
    server.requests.clear()
    write_assignment(course, front="closses: 2026-12-12 18:00\n")
    result = push(course, monkeypatch, server, "--drop-assignments")
    assert result.exit_code == 1
    assert assignment_writes(server) == []
    assert "lab" in server.assignments


def test_no_prune_holds_back_the_delete(course, monkeypatch):
    server = pushed(course, monkeypatch)
    result = push(course, monkeypatch, server, "--drop-assignments", "--no-prune")
    assert result.exit_code == 0, result.output
    assert assignment_writes(server) == []
    assert "skipped  delete assignment lab" in result.output


#
# A failed write
#
def test_a_failed_put_does_not_advance_the_base_and_the_next_push_retries(
    course, monkeypatch
):
    write_assignment(course)
    server = FakeCourseServer()
    server.failing.add(f"{ASSIGNMENT}/lab")
    result = push(course, monkeypatch, server)
    assert result.exit_code == 1
    assert "failed" in result.output
    assert "lab" not in stored_base(course)

    server.failing.clear()
    result = push(course, monkeypatch, server)
    assert result.exit_code == 0, result.output
    assert server.assignments["lab"]["title"] == "Lab"
    assert "lab" in stored_base(course)


def test_a_stale_version_is_reported_as_a_failure(course, monkeypatch):
    write_assignment(course)
    server = FakeCourseServer()
    push(course, monkeypatch, server)
    write_assignment(course, body="changed\n")
    # The version moves between the read and the write.
    original = server.put_assignment

    def racing(slug, request):
        server.assignments[slug]["updatedAt"] = server.tick()
        return original(slug, request)

    server.put_assignment = racing
    result = push(course, monkeypatch, server)
    assert result.exit_code == 1
    assert "412" in result.output
