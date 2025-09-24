import builtins
import pprint
import pytest
from pathlib import Path
from mdq.questions import MultipleChoiceQuestion
from mdq.parser import parse_question

builtins.dbg = pprint.pprint  # type: ignore
REPO_DIR = Path(__file__).parent.parent


@pytest.fixture
def mdq():
    def get_src(path):
        path = REPO_DIR / "examples" / (path + ".q.md")
        return open(path)

    return get_src


def test_parse_multiple_choice_question(mdq):
    src = mdq("multiple-choice-1")
    qst: MultipleChoiceQuestion = parse_question(src)
    assert qst.title == "Multiple Choice 1"
    assert qst.slug == "multiple-choice-1"
    assert not qst.is_ordered
    assert len(qst.choices) == 4
    assert [c.text for c in qst.choices] == ["0", "1", "2", "42"]
    assert [c.is_correct for c in qst.choices] == [False, False, False, True]
