from pathlib import Path

import rich
import rich.pretty

from mdq import parse_question

ast = parse_question(Path("examples/exam-a.md"))
rich.pretty.pprint(ast)
