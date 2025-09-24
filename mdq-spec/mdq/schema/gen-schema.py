from typing import Any
import ruamel.yaml
import json
from pathlib import Path
from .transforms import Transformer


BASE = Path(__file__).parent.parent

yaml = ruamel.yaml.YAML(typ="safe")


def main():
    with open(BASE / "schemas" / "mdq.yml") as fd:
        schema = yaml.load(fd)

    with open(BASE / "schemas" / "mdq.verbose.json", "w") as fd:
        json.dump(schema, fd, indent=4)

    with open(BASE / "schemas" / "mdq.json", "w") as fd:
        json.dump(schema, fd)

    with open(BASE / "schemas" / "to-student.yml") as fd:
        to_student_rules = yaml.load(fd)

    transformer = Transformer(to_student_rules)
    student_schema = transformer.transform(schema)

    with open(BASE / "schemas" / "mdq-student.verbose.json", "w") as fd:
        json.dump(student_schema, fd, indent=4)

    with open(BASE / "schemas" / "mdq-student.json", "w") as fd:
        json.dump(student_schema, fd)


if __name__ == "__main__":
    main()
