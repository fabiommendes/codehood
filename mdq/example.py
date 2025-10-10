from pathlib import Path

import rich
import rich.pretty

from mdq import parse_exam

ast = parse_exam(Path("examples/exam-a.md"))
rich.pretty.pprint(ast)
