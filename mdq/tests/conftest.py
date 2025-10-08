import builtins
from pathlib import Path

import pytest
from rich.pretty import pprint

builtins.dbg = pprint
REPO_DIR = Path(__file__).parent.parent


@pytest.fixture
def mdq():
    def get_src(path, exam: bool = False):
        ext = ".md" if exam else ".q.md"
        path = REPO_DIR / "examples" / (path + ext)
        return open(path)

    return get_src
