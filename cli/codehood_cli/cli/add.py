from typing import Annotated

import typer

from .. import config
from ..classroom import parse_classroom_slug

app = typer.Typer(help="Add  resources to classroom.")
EXAM_TEMPLATE = """# {title}{description}
{config}{preamble}
---
## [q1] Multiple choice question

    weight: 1.0

Mark the correct answer.

* Option 1
* [x] Option 2
* Option 3
* Option 4
* Option 5

---
## [q2] True or False

    weight: 1.0

Mark the correct answer.

* [T] Option 1
* [F] Option 2
* [F] Option 3
* [T] Option 4
* [F] Option 5
"""


@app.command()
def exam(
    classroom: Annotated[
        str, typer.Argument(help="Classroom slug in the format 'discipline/edition'")
    ],
    id: Annotated[str, typer.Argument(help="Exam ID (e.g., 'midterm', 'final')")],
    title: Annotated[
        str, typer.Option(..., "--title", "-t", help="Exam title")
    ] = "Exam Title",
    description: Annotated[
        str, typer.Option(..., "--description", "-d", help="Exam description")
    ] = "",
    preamble: Annotated[
        str, typer.Option(..., "--preamble", "-p", help="Exam preamble (optional)")
    ] = "",
    shuffle: Annotated[
        bool,
        typer.Option(help="Disable shuffling"),
    ] = True,
    markdown: Annotated[
        bool,
        typer.Option(help="Disable Markdown text rendering"),
    ] = True,
):
    """
    Add a new exam to the classroom.
    """
    cfg = config.load()
    cls = parse_classroom_slug(classroom)

    # Normalize config
    exam_config = {}
    if not shuffle:
        exam_config["shuffle"] = "false"
    if not markdown:
        exam_config["format"] = "text"
    if exam_config:
        config_data = "\n".join(f"    {k}: {v}" for k, v in exam_config.items())
        config_data = f"\n{config_data}\n"
    else:
        config_data = ""

    # Normalize description/preamble
    if description:
        description = f"\n## {description}"
    if preamble:
        preamble = f"\n{preamble}"

    exam_path = cls.path() / f"{id}.md"
    exam_data = EXAM_TEMPLATE.format(
        title=title,
        description=description,
        config=config_data,
        preamble=preamble,
    )
    exam_path.write_text(exam_data)


@app.command()
def question(
    slug: Annotated[
        str, typer.Argument(help="Classroom slug in the format 'discipline/edition'")
    ],
):
    """
    Add a new question to the classroom.
    """
    typer.echo(f"Adding question to classroom {slug}...")


@app.command()
def event(
    title: Annotated[str, typer.Argument(help="Event title")],
):
    """
    Add a new event to the classroom.
    """
    typer.echo(f"Adding event to classroom {title}...")
