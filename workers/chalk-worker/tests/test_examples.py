import json
from pathlib import Path

import pytest

from chalk_worker.examples import (
    ExampleError,
    answer_module,
    example_cases,
    examples_module,
    locate_example,
)
from chalk_worker.locate import locate_elm

TABLE = json.loads((Path(__file__).parent / "resources" / "elm-examples-cases.json").read_text())
ENTRIES = TABLE["entries"]


@pytest.mark.parametrize("entry", ENTRIES, ids=[e["name"][:60] for e in ENTRIES])
def test_shared_table(entry) -> None:
    text, file, index = entry["input"], entry["answerFile"], entry["index"]
    if "error" in entry:
        with pytest.raises(ExampleError) as raised:
            example_cases(text)
        assert (raised.value.kind, raised.value.line) == (
            entry["error"]["kind"],
            entry["error"]["line"],
        )
        with pytest.raises(ExampleError):
            examples_module(text, index, file)
        return
    cases = [{"name": c.name, "line": c.line, "public": c.public} for c in example_cases(text)]
    assert cases == entry["cases"]
    assert examples_module(text, index, file) == entry["module"]
    assert examples_module(text, index, file, public_only=True) == entry["publicModule"]


def test_answer_module() -> None:
    assert answer_module("Main.elm") == "Main"
    assert answer_module("Foo/Bar.elm") == "Foo.Bar"


def test_locator_finds_the_line_of_the_case() -> None:
    text = "f 1 ==> 1\n\nf 2 ==> 2 -- two\n"
    assert locate_example(text, "f 2 ==> 2 (two)") == 3
    assert locate_example(text, "other") is None
    assert locate_example("f 1\n", "f 1") is None
    assert locate_elm([text], "Examples0", "f 2 ==> 2 (two)") == (0, 3)
    assert locate_elm(["module A exposing (t)\n", text], "Examples1", "f 1 ==> 1") == (1, 1)
