"""
Tests for `codehood.assignments`, the pure core of `codehood assignment`.
"""

from __future__ import annotations

import pytest
from fake_course_server import team_json
from hypothesis import given
from hypothesis import strategies as st

from codehood.api import generated
from codehood.assignments import (
    AmbiguousTeamError,
    TeamNotFoundError,
    find_team,
    folder_name,
    git_env,
    parse_deadline,
    plan_folders,
    redact,
    target_sha,
)


def team(public_id: str, name: str, members=("ana",), **kwargs) -> generated.TeamListed:
    return generated.TeamListed.model_validate(
        team_json(public_id, name, members, **kwargs)
    )


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Team A", "Team-A"),
        ("../x", "x"),
        ("a/b", "a-b"),
        ("a\\b", "a-b"),
        ("..", "team"),
        ("   ", "team"),
        ("", "team"),
        ("con", "con_"),
        ("NUL", "NUL_"),
        ("com1.txt", "com1.txt_"),
        ("Équipe ünï", "Équipe-ünï"),
        (".hidden", "hidden"),
        ('a:b*c?"d<e>f|g', "a-b-c-d-e-f-g"),
        ("tab\tand\nnewline", "tab-and-newline"),
    ],
)
def test_folder_names_are_one_safe_component(name, expected):
    assert folder_name(name) == expected


@given(st.text())
def test_a_folder_name_never_leaves_its_parent(name):
    result = folder_name(name)
    assert result not in ("", ".", "..")
    assert "/" not in result and "\\" not in result and "\0" not in result
    assert len(result.encode()) <= 101


def test_teams_keep_a_folder_they_already_have_whatever_their_name():
    teams = [team("a", "Renamed"), team("b", "Bravo")]
    folders = plan_folders(teams, {"a": "Alpha"})
    assert folders == {"a": "Alpha", "b": "Bravo"}


def test_colliding_names_all_get_the_public_id():
    teams = [team("a", "Same"), team("b", "same"), team("c", "Other")]
    assert plan_folders(teams, {}) == {"a": "Same-a", "b": "same-b", "c": "Other"}


def test_a_new_team_does_not_take_the_folder_of_another_one():
    teams = [team("a", "Alpha"), team("b", "Alpha")]
    assert plan_folders([teams[1]], {"a": "Alpha"}) == {"a": "Alpha", "b": "Alpha-b"}
    assert plan_folders([teams[1]], {}, taken=["alpha"]) == {"b": "Alpha-b"}


def test_individual_assignments_name_folders_after_the_student():
    teams = [team("a", "Team 1", ("ana",)), team("b", "Team 2", ())]
    assert plan_folders(teams, {}, individual=True) == {"a": "ana", "b": "Team-2"}


def test_the_delivery_to_check_out():
    both = team("a", "A", on_time="1" * 40, late="2" * 40)
    on_time = team("b", "B", on_time="3" * 40)
    late = team("c", "C", late="4" * 40)
    none = team("d", "D")
    assert target_sha(both, late=False) == "1" * 40
    assert target_sha(both, late=True) == "2" * 40
    assert target_sha(on_time, late=True) == "3" * 40
    assert target_sha(late, late=False) is None
    assert target_sha(late, late=True) == "4" * 40
    assert target_sha(none, late=True) is None


def test_a_team_is_found_by_name_then_by_member():
    teams = [team("a", "bob", ("ana",)), team("b", "Bravo", ("bob", "bea"))]
    assert find_team(teams, "bob").public_id == "a"
    assert find_team(teams, "bea").public_id == "b"
    with pytest.raises(TeamNotFoundError):
        find_team(teams, "zed")


def test_two_matches_are_ambiguous():
    teams = [team("a", "Same"), team("b", "Same", ("bob",))]
    with pytest.raises(AmbiguousTeamError):
        find_team(teams, "Same")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-12-12 18:00", "2026-12-12T18:00:00.000Z"),
        ("2026-12-12T18:00:00-03:00", "2026-12-12T21:00:00.000Z"),
        ("2026-12-12T18:00:00Z", "2026-12-12T18:00:00.000Z"),
    ],
)
def test_deadlines_parse_as_exam_dates_do(text, expected):
    assert parse_deadline(text) == expected


@pytest.mark.parametrize("text", ["2026-12-12", "soon", "", "2026-02-30 10:00"])
def test_a_deadline_needs_a_date_and_a_time(text):
    with pytest.raises(ValueError):
        parse_deadline(text)


def test_git_env_scopes_the_header_to_the_server_and_keeps_other_settings():
    base = {"PATH": "/bin", "GIT_CONFIG_COUNT": "1", "GIT_DIR": "/elsewhere/.git"}
    env = git_env(base, "https://codehood.example/a/git", "Bearer k")
    assert env["GIT_CONFIG_COUNT"] == "2"
    assert env["GIT_CONFIG_KEY_1"] == "http.https://codehood.example/a/git/.extraHeader"
    assert env["GIT_CONFIG_VALUE_1"] == "Authorization: Bearer k"
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert "GIT_DIR" not in env and env["PATH"] == "/bin"
    assert base["GIT_CONFIG_COUNT"] == "1"


def test_redact_scrubs_every_secret():
    assert redact("a k1 b k2 k1", ["k1", "k2", ""]) == "a *** b *** ***"
