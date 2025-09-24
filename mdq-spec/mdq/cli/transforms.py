import json
from rich import print_json
import tyro
from pathlib import Path
from ruamel.yaml import YAML

from ..transforms import remove_keys, expand_refs

yaml = YAML(typ="safe")


def transform(file: Path, operation: str, output: Path | None = None):
    """
    Main function to handle command line arguments.

    Args:
        file (Path): The path to schema the file.
        operation (str): The operation to perform on the file.
    """

    schema = yaml.load(file.open())

    match operation:
        case "expand":
            result = expand_refs(schema)
        case "simplify":
            keys = schema["$defs"]["_private-keys"]["enum"]
            result = remove_keys(schema, keys)
        case _:
            raise ValueError(f"Unknown operation: {operation}")

    if output is None:
        print_json(json.dumps(result))
    else:
        with output.open("w") as fd:
            if output.suffix == ".json":
                json.dump(result, fd, indent=2)
            elif output.suffix in (".yaml", ".yml"):
                yaml.dump(result, fd)
            else:
                raise ValueError(f"Unknown output file type: {output.suffix}")


def main():
    """
    Main function to handle command line arguments.
    """
    tyro.cli(transform, description="Transform JSON schema files.")
