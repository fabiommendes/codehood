import pytest

from chalk_worker.examples import ExampleError, examples_module, locate_example, parse_examples
from chalk_worker.locate import locate_elm


def one(text: str):
    (example,) = parse_examples(text)
    return example


def test_plain_example() -> None:
    e = one("collatzLength 5 ==> 6\n")
    assert (e.line, e.expr, e.value, e.name) == (1, "collatzLength 5", "6", "collatzLength 5 ==> 6")


def test_comment_goes_into_the_name() -> None:
    e = one("f 1 ==> 1 -- a sequência é só o 1")
    assert e.value == "1"
    assert e.name == "f 1 ==> 1 (a sequência é só o 1)"


def test_negative_number_is_wrapped() -> None:
    mod = examples_module("collatzLength -42 ==> 0", 0, "Main")
    assert "Expect.equal (0) (collatzLength -42)" in mod


def test_list_and_just() -> None:
    assert one("primes 5 ==> [ 2, 3, 5 ]").value == "[ 2, 3, 5 ]"
    assert one("find 97 ==> Just 97").value == "Just 97"


def test_arrow_and_comment_inside_a_string_are_text() -> None:
    e = one('f "a==>b -- c" ==> "x--y" -- real')
    assert (e.expr, e.value, e.comment) == ('f "a==>b -- c"', '"x--y"', "real")
    assert examples_module('f "a" ==> "b"', 0, "Main").count('\\"') == 4


def test_char_literal_and_primes_in_names() -> None:
    assert one("f 'a' ==> '-'").value == "'-'"
    assert one("foldl' (+) 0 [1] ==> 1").expr == "foldl' (+) 0 [1]"


def test_blank_and_comment_lines_are_skipped_and_lines_counted() -> None:
    es = parse_examples("-- intro\n\nf 1 ==> 1\n\nf 2 ==> 2\n")
    assert [e.line for e in es] == [3, 5]


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("f 1 ==> 1\nf 2\n", "line 2"),
        ("==> 1", "line 1"),
        ("f 1 ==>", "line 1"),
        ("f 1 ==> 1 ==> 1", "line 1"),
        ('f "a ==> 1', "line 1"),
    ],
)
def test_invalid_line_reports_its_number(text: str, line: str) -> None:
    with pytest.raises(ExampleError, match=line):
        parse_examples(text)


def test_empty_block_is_invalid() -> None:
    with pytest.raises(ExampleError):
        parse_examples("-- nothing\n")


def test_module_shape() -> None:
    mod = examples_module("f 1 ==> 1\nf 2 ==> 2 -- two", 3, "Main")
    assert mod.startswith("module Examples3 exposing (suite)")
    assert "import Main exposing (..)" in mod
    assert '[ test "f 1 ==> 1" <|' in mod
    assert '        , test "f 2 ==> 2 (two)" <|' in mod


def test_locator_finds_the_line_of_the_example() -> None:
    text = "f 1 ==> 1\n\nf 2 ==> 2 -- two\n"
    assert locate_example(text, "f 2 ==> 2 (two)") == 3
    assert locate_example(text, "other") is None
    assert locate_elm([text], "Examples0 examples", "f 2 ==> 2 (two)") == (0, 3)
    assert locate_elm(["module A exposing (t)\n", text], "Examples1 examples", "f 1 ==> 1") == (
        1,
        1,
    )
