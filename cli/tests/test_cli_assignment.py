"""
Tests for `codehood assignment`: `status`, `clone`, `extend` and `move`.

The REST API is `FakeCourseServer`; the git side is real: bare repositories
served over smart HTTP by `git_http.GitHttpServer`, which wraps `git
http-backend` and asks for `Authorization: Bearer <key>`.
"""

from __future__ import annotations

import importlib
import json
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from fake_course_server import BASE, FakeCourseServer, team_json
from git_http import GitHttpServer, TeamRepo, git
from typer.testing import CliRunner

from codehood.api import base as base_module
from codehood.cli.base import app

assignment_module = importlib.import_module("codehood.cli.assignment")
runner = CliRunner()

KEY = "sekret-key-0123456789"
CREATED = "2026-12-10T20:00:00.000Z"


@dataclass
class World:
    course: Path
    git: GitHttpServer
    rest: FakeCourseServer
    tmp: Path

    def team(
        self,
        public_id: str,
        name: str,
        members: tuple[str, ...] = ("ana",),
        *,
        on_time: bool = True,
        late: bool = False,
        **extra,
    ) -> TeamRepo:
        """
        A team with a real repository: one commit on time and, with `late`,
        another one after it.
        """
        repo = TeamRepo(self.tmp / "repos", public_id)
        self.git.add(repo)
        first = repo.commit({"main.py": f"print({public_id!r})\n"}, "first")
        tip = (
            repo.commit({"main.py": f"print({public_id!r}, 2)\n"}, "late")
            if late
            else None
        )
        repo.first, repo.tip = first, tip or first  # type: ignore[attr-defined]
        self.rest.teams.setdefault("lab", []).append(
            team_json(
                public_id,
                name,
                members,
                on_time=first if on_time else None,
                late=tip if late else None,
                **extra,
            )
        )
        return repo

    def run(self, *args: str, input: str | None = None):
        return runner.invoke(app, ["assignment", *args, str(self.course)], input=input)

    def folder(self, *parts: str) -> Path:
        return self.course / "submissions" / "lab" / Path(*parts)


@pytest.fixture
def world(tmp_path, monkeypatch) -> World:
    server = GitHttpServer(KEY)
    server.start()
    course = tmp_path / "course"
    course.mkdir()
    (course / "codehood.toml").write_text(
        '[course]\ndiscipline = "cs101"\ninstructor = "ada"\nedition = "2026-1"\n'
        f'\n[server]\nurl = "{server.url}"\n',
        encoding="utf-8",
    )
    base_module.save_token(server.url, KEY)
    rest = FakeCourseServer()
    rest.create_assignment("lab", title="Lab", teamMin=2, teamMax=3)

    def get_client(base_url=None):
        return httpx.Client(
            base_url=base_url or server.url, transport=httpx.MockTransport(rest.handle)
        )

    monkeypatch.setattr(assignment_module, "get_client", get_client)
    yield World(course, server, rest, tmp_path)
    server.stop()


def local(text: str) -> str:
    return datetime.fromisoformat(text).astimezone().strftime("%Y-%m-%d %H:%M")


def row(output: str, name: str) -> str:
    (line,) = [x for x in output.splitlines() if f" {name} " in x]
    return line


#
# status
#
def test_status_shows_every_state_of_a_team(world):
    a = world.team("a", "Alpha", ("ana", "ann"))
    b = world.team("b", "Bravo", ("bob",), on_time=False, late=True)
    c = world.team("c", "Charlie", ("cy",), late=True)
    world.team("d", "Delta", ("dan",), on_time=False)
    world.team("e", "Echo", ("eve",), extended=True, due_at="2026-12-12T21:00:00.000Z")
    world.team("f", "Foxtrot", ("fay", "fox", "flo", "fil"), size_exception="above")
    world.team("g", "Golf", (), on_time=False, size_exception="empty")

    result = world.run("status", "lab")

    assert result.exit_code == 0, result.output
    assert "Lab (lab), due" in result.output
    alpha = row(result.output, "Alpha")
    assert "ana, ann" in alpha
    assert f"{a.first[:7]} {local(CREATED)} ana" in alpha
    bravo = row(result.output, "Bravo")
    assert b.tip[:7] in bravo and bravo.count(local(CREATED)) == 1
    charlie = row(result.output, "Charlie")
    assert c.first[:7] in charlie and c.tip[:7] in charlie
    delta = row(result.output, "Delta")
    assert local(CREATED) not in delta
    echo = row(result.output, "Echo")
    assert f"extended to {local('2026-12-12T21:00:00.000Z')}" in echo
    assert "above the maximum size" in row(result.output, "Foxtrot")
    golf = row(result.output, "Golf")
    assert "no members" in golf


def test_status_of_an_individual_assignment_lists_students(world):
    world.rest.create_assignment("lab", title="Lab", teamMin=1, teamMax=1)
    world.team("a", "ana-team", ("ana",))
    world.team("b", "b-team", ())
    result = world.run("status", "lab")
    assert result.exit_code == 0, result.output
    header = result.output.splitlines()[1:4]
    assert any("Student" in line for line in header)
    assert "Members" not in result.output and "Team" not in result.output
    assert "ana" in result.output


def test_status_without_teams_says_so(world):
    result = world.run("status", "lab")
    assert result.exit_code == 0, result.output
    assert "no teams yet" in result.output


def test_status_of_an_unknown_assignment_is_a_clear_error(world):
    result = world.run("status", "nope")
    assert result.exit_code == 1
    assert "no assignment 'nope' in this course" in result.output
    assert "Traceback" not in result.output


def test_status_reads_every_page_of_teams(world):
    for number in range(5):
        world.team(f"t{number}", f"Team{number}", (f"u{number}",))
    world.rest.team_page_size = 2
    result = world.run("status", "lab")
    assert result.exit_code == 0, result.output
    for number in range(5):
        assert f"Team{number}" in result.output
    assert len(world.rest.requests_to("GET", f"{BASE}/assignment/lab/team")) == 3


#
# clone
#
def head(folder: Path) -> str:
    return git(folder, "rev-parse", "HEAD")


def test_clone_checks_out_each_team_on_its_delivery_on_time(world):
    a = world.team("a", "Alpha", late=True)
    b = world.team("b", "Bravo")
    result = world.run("clone", "lab")
    assert result.exit_code == 0, result.output
    assert head(world.folder("Alpha")) == a.first != a.tip
    assert head(world.folder("Bravo")) == b.first
    assert (world.folder("Alpha") / "main.py").read_text() == "print('a')\n"
    # Detached, with no local branch, and the team recorded.
    assert git(world.folder("Alpha"), "for-each-ref", "refs/heads") == ""
    assert git(world.folder("Alpha"), "config", "codehood.team") == "a"
    assert "2 cloned" in result.output


def test_late_checks_out_the_late_delivery_or_falls_back_to_the_one_on_time(world):
    a = world.team("a", "Alpha", late=True)
    b = world.team("b", "Bravo")
    result = world.run("clone", "lab", "--late")
    assert result.exit_code == 0, result.output
    assert head(world.folder("Alpha")) == a.tip
    assert head(world.folder("Bravo")) == b.first


def test_running_again_updates_the_same_repository(world):
    a = world.team("a", "Alpha")
    assert world.run("clone", "lab").exit_code == 0
    inode = os.stat(world.folder("Alpha") / ".git").st_ino
    assert head(world.folder("Alpha")) == a.first

    newer = a.commit({"main.py": "print('new')\n"}, "again")
    world.rest.teams["lab"][0]["delivery"]["onTime"]["newSha"] = newer
    result = world.run("clone", "lab")

    assert result.exit_code == 0, result.output
    assert os.stat(world.folder("Alpha") / ".git").st_ino == inode
    assert head(world.folder("Alpha")) == newer
    assert "1 updated" in result.output
    assert world.run("clone", "lab").output.count("current") >= 1


def test_a_renamed_team_keeps_its_folder(world):
    world.team("a", "Alpha")
    assert world.run("clone", "lab").exit_code == 0
    world.rest.teams["lab"][0]["name"] = "Renamed"
    result = world.run("clone", "lab")
    assert result.exit_code == 0, result.output
    assert sorted(p.name for p in world.folder().iterdir()) == ["Alpha"]


def test_a_team_without_the_delivery_gets_no_folder_and_is_listed_last(world):
    world.team("a", "Alpha")
    world.team("b", "Bravo", on_time=False)
    world.team("c", "Charlie", on_time=False)
    result = world.run("clone", "lab")
    assert result.exit_code == 0, result.output
    assert not world.folder("Bravo").exists()
    assert not world.folder("Charlie").exists()
    lines = result.output.splitlines()
    assert lines.index("no delivery on time: Bravo, Charlie") < len(lines) - 1
    assert "2 without delivery" in lines[-1]


def test_dest_replaces_submissions(world):
    world.team("a", "Alpha")
    elsewhere = world.tmp / "elsewhere"
    result = runner.invoke(
        app,
        ["assignment", "clone", "lab", "--dest", str(elsewhere), str(world.course)],
    )
    assert result.exit_code == 0, result.output
    assert (elsewhere / "lab" / "Alpha" / "main.py").is_file()
    assert not (world.course / "submissions").exists()


def test_hostile_team_names_stay_inside_the_destination(world):
    names = [
        "../x",
        "a/b",
        "con",
        "two  words",
        "Équipe ünï 🚀",
        "dup",
        "Dup",
        "..",
        "/etc",
    ]
    for number, name in enumerate(names):
        world.team(f"p{number}", name, (f"u{number}",))
    world.team("p9", "dup", ("u9",))
    result = world.run("clone", "lab")
    assert result.exit_code == 0, result.output

    root = world.folder().resolve()
    children = sorted(root.iterdir())
    assert len(children) == len(names) + 1
    for child in children:
        assert child.resolve().parent == root
        assert (child / "main.py").is_file()
    folders = {child.name for child in children}
    assert {"x", "a-b", "con_", "two-words", "Équipe-ünï-🚀"} <= folders
    # The three that collide all carry their id.
    assert {"dup-p5", "Dup-p6", "dup-p9"} <= folders
    assert not (world.course / "submissions" / "x").exists()
    assert not (world.tmp / "x").exists()
    assert not Path("/etc/main.py").exists()


def test_an_individual_assignment_uses_the_username(world):
    world.rest.create_assignment("lab", title="Lab", teamMin=1, teamMax=1)
    world.team("a", "whatever", ("ana",))
    result = world.run("clone", "lab")
    assert result.exit_code == 0, result.output
    assert head(world.folder("ana"))


class Spy:
    """
    Every subprocess the CLI starts, with its arguments and environment.
    """

    def __init__(self, monkeypatch) -> None:
        self.calls: list[tuple[list[str], dict[str, str]]] = []
        real = subprocess.run

        def run(args, *rest, **kwargs):
            env = kwargs.get("env") or {}
            if isinstance(args, list) and args[:1] == ["git"] and "-C" in args:
                self.calls.append((list(args), dict(env)))
            return real(args, *rest, **kwargs)

        monkeypatch.setattr(subprocess, "run", run)


def test_the_key_reaches_git_only_through_its_environment(world, monkeypatch):
    spy = Spy(monkeypatch)
    world.team("a", "Alpha")
    world.team("b", "Bravo")
    world.git.refuse.add("b")

    result = world.run("clone", "lab")

    assert result.exit_code == 1
    assert spy.calls
    assert all(not any(KEY in arg for arg in args) for args, _ in spy.calls)
    fetches = [(args, env) for args, env in spy.calls if "fetch" in args]
    assert len(fetches) == 2
    for _, env in fetches:
        assert env["GIT_TERMINAL_PROMPT"] == "0"
        header = env[f"GIT_CONFIG_VALUE_{int(env['GIT_CONFIG_COUNT']) - 1}"]
        assert header == f"Authorization: Bearer {KEY}"
    assert KEY not in result.output
    assert KEY not in (result.stderr if result.stderr_bytes else "")

    folder = world.folder("Alpha")
    assert KEY not in git(folder, "config", "--list", "--show-origin")
    assert KEY not in git(folder, "remote", "get-url", "origin")
    assert KEY not in (folder / ".git" / "config").read_text()
    for path in (folder / ".git").rglob("*"):
        if path.is_file() and path.stat().st_size < 1_000_000:
            assert KEY.encode() not in path.read_bytes(), path
    # The server did see it, on the team it let in.
    authorized = [headers for path, headers in world.git.requests if "/team/a/" in path]
    assert authorized
    assert all(h["authorization"] == f"Bearer {KEY}" for h in authorized)
    assert all(h["authorization"] == f"Bearer {KEY}" for _, h in world.git.requests)


def test_one_team_failing_does_not_stop_the_others(world):
    world.team("a", "Alpha")
    world.team("b", "Bravo")
    world.team("c", "Charlie")
    world.git.refuse.add("b")
    result = world.run("clone", "lab")
    assert result.exit_code == 1
    assert head(world.folder("Alpha"))
    assert head(world.folder("Charlie"))
    assert "failed   Bravo" in result.output
    assert "1 failed" in result.output and "2 cloned" in result.output


def test_a_failed_team_is_retried_on_the_next_run(world):
    a = world.team("a", "Alpha")
    world.git.refuse.add("a")
    assert world.run("clone", "lab").exit_code == 1
    world.git.refuse.clear()
    result = world.run("clone", "lab")
    assert result.exit_code == 0, result.output
    assert head(world.folder("Alpha")) == a.first


def test_a_folder_edited_by_the_teacher_is_left_untouched(world):
    a = world.team("a", "Alpha")
    assert world.run("clone", "lab").exit_code == 0
    edited = world.folder("Alpha") / "main.py"
    edited.write_text("# graded by hand\n")
    newer = a.commit({"main.py": "print('new')\n"})
    world.rest.teams["lab"][0]["delivery"]["onTime"]["newSha"] = newer

    result = world.run("clone", "lab")

    assert result.exit_code == 0, result.output
    assert "warning  Alpha left as it is" in result.output
    assert edited.read_text() == "# graded by hand\n"
    assert head(world.folder("Alpha")) == a.first


def test_untracked_files_do_not_block_an_update(world):
    a = world.team("a", "Alpha")
    assert world.run("clone", "lab").exit_code == 0
    (world.folder("Alpha") / "__pycache__.txt").write_text("x")
    newer = a.commit({"main.py": "print('new')\n"})
    world.rest.teams["lab"][0]["delivery"]["onTime"]["newSha"] = newer
    assert world.run("clone", "lab").exit_code == 0
    assert head(world.folder("Alpha")) == newer


#
# extend
#
def patches(world):
    return world.rest.requests_to("PATCH", f"{BASE}/assignment/lab/team/a")


def test_extend_by_team_name(world):
    world.team("a", "Alpha", ("ana",))
    world.team("b", "Bravo", ("bob",))
    result = world.run("extend", "lab", "Alpha", "2026-12-12T18:00:00-03:00")
    assert result.exit_code == 0, result.output
    assert world.rest.teams["lab"][0]["dueAt"] == "2026-12-12T21:00:00.000Z"
    assert world.rest.teams["lab"][1]["dueAt"] != "2026-12-12T21:00:00.000Z"
    (patch,) = patches(world)
    assert json.loads(patch.content) == {"dueAt": "2026-12-12T21:00:00.000Z"}
    assert "Alpha" in result.output


def test_extend_by_the_username_of_a_member(world):
    world.team("a", "Alpha", ("ana", "ann"))
    result = world.run("extend", "lab", "ann", "2026-12-12 18:00")
    assert result.exit_code == 0, result.output
    assert world.rest.teams["lab"][0]["dueAt"] == "2026-12-12T18:00:00.000Z"


def test_a_team_name_beats_a_username(world):
    world.team("a", "bob", ("ana",))
    world.team("b", "Bravo", ("bob",))
    assert world.run("extend", "lab", "bob", "2026-12-12 18:00").exit_code == 0
    assert len(patches(world)) == 1


@pytest.mark.parametrize("date", ["next friday", "2026-13-40 10:00", "2026-12-12", ""])
def test_extend_refuses_a_bad_date_without_calling_the_server(world, date):
    world.team("a", "Alpha")
    result = world.run("extend", "lab", "Alpha", date)
    assert result.exit_code == 1
    assert "error:" in result.output
    assert world.rest.requests_to("PATCH", f"{BASE}/assignment/lab/team/a") == []


def test_extend_a_date_without_a_time_says_why(world):
    world.team("a", "Alpha")
    result = world.run("extend", "lab", "Alpha", "2026-12-12")
    assert "no time of day" in result.output


def test_extend_an_unknown_team_is_an_error(world):
    world.team("a", "Alpha")
    result = world.run("extend", "lab", "Nobody", "2026-12-12 18:00")
    assert result.exit_code == 1
    assert "Nobody" in result.output
    assert patches(world) == []


def test_extend_an_ambiguous_team_is_an_error(world):
    world.team("a", "Same", ("ana",))
    world.team("b", "Same", ("bob",))
    result = world.run("extend", "lab", "Same", "2026-12-12 18:00")
    assert result.exit_code == 1
    assert "matches 2 teams" in result.output
    assert patches(world) == []


#
# move
#
def test_move_puts_the_student_in_the_team(world):
    world.team("a", "Alpha", ("ana",))
    world.team("b", "Bravo", ("bob",))
    result = world.run("move", "lab", "bob", "Alpha")
    assert result.exit_code == 0, result.output
    members = [m["username"] for m in world.rest.teams["lab"][0]["members"]]
    assert members == ["ana", "bob"]
    assert world.rest.teams["lab"][1]["members"] == []
    assert "bob is now in Alpha" in result.output


def test_move_shows_the_servers_refusal(world):
    world.team("a", "Alpha", ("ana",))
    world.rest.member_error = (400, "the team is already at its maximum size")
    result = world.run("move", "lab", "bob", "Alpha")
    assert result.exit_code == 1
    assert "the team is already at its maximum size" in result.output
    assert "400" in result.output
    assert "Traceback" not in result.output
