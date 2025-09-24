from typing import Any
import ruamel.yaml
import json
import jsonschema
from pathlib import Path
from rich import print

BASE = Path(__file__).parent.parent
type JSON = Any
yaml = ruamel.yaml.YAML(typ="safe")


def run_examples(schema: JSON):
    examples_folder = Path("examples")
    jsonschema.Draft202012Validator.check_schema(schema)
    validator = jsonschema.Draft202012Validator(schema)

    for example in examples_folder.iterdir():
        with example.open() as fd:
            match example.suffix:
                case ".yaml":
                    doc = yaml.load(fd)
                case ".json" | ".q.json" | ".jsonq":
                    doc = json.load(fd)
                case ext:
                    print(f"[red]Error:[/red] invalid file extension: {ext}")

            if validator.is_valid(doc, schema):
                print(f"- {example.name} [green]OK")
            else:
                print(f"- {example.name} [red]FAIL")
