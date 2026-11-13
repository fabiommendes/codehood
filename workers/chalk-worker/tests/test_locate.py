from conftest import HIDDEN, PRETESTS

from chalk_worker.locate import elm_module, locate_elm

SOURCES = [PRETESTS, HIDDEN]


def test_module_name() -> None:
    assert elm_module(PRETESTS) == "Pre"
    assert elm_module("port module Ports.Io exposing (..)\n") == "Ports.Io"
    assert elm_module("-- no module header\n") is None


def test_case_by_module_and_name() -> None:
    assert locate_elm(SOURCES, "Pre pre", "vazia") == (0, 12)
    assert locate_elm(SOURCES, "Hidden hidden", "negativos") == (1, 14)


def test_unknown_module_or_name() -> None:
    assert locate_elm(SOURCES, "Other x", "vazia") is None
    assert locate_elm(SOURCES, "Pre pre", "nope") is None


def test_same_name_in_two_describes_uses_the_innermost_describe() -> None:
    src = (
        "module T exposing (tests)\n"
        "tests =\n"
        '    describe "all"\n'
        '        [ describe "a"\n'
        '            [ test "x" <| \\_ -> Expect.pass ]\n'
        '        , describe "b"\n'
        '            [ test "x" <| \\_ -> Expect.pass ]\n'
        "        ]\n"
    )
    assert locate_elm([src], "T all a", "x") == (0, 5)
    assert locate_elm([src], "T all b", "x") == (0, 7)


def test_fuzz_todo_and_escaped_quotes() -> None:
    src = (
        "module F exposing (tests)\n"
        "tests =\n"
        '    describe "f"\n'
        '        [ fuzz Fuzz.int "inteiro" <| \\n -> Expect.pass\n'
        '        , fuzz2 Fuzz.int Fuzz.int "dois" <| \\a b -> Expect.pass\n'
        '        , todo "depois"\n'
        '        , test "diz \\"oi\\"" <| \\_ -> Expect.pass\n'
        "        ]\n"
    )
    assert locate_elm([src], "F f", "inteiro") == (0, 4)
    assert locate_elm([src], "F f", "dois") == (0, 5)
    assert locate_elm([src], "F f", "depois") == (0, 6)
    assert locate_elm([src], "F f", 'diz "oi"') == (0, 7)
