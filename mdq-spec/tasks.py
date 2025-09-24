import json
from pathlib import Path
from typing import Any, Mapping
from invoke import task, Context as Ctx
from rich import print
from contextlib import contextmanager

SCHEMA_VERSION = "0.1"
SCHEMA_CDN = f"https://cdn.jsdelivr.net/gh/mdq-format/schema@v{SCHEMA_VERSION}/"
BASEDIR = Path(__file__).parent
TMPDIR = BASEDIR / ".tmp"
GENERATE_TYPES = ["pydantic", "elm"]


@task
def bundle(ctx: Ctx, build: Path = BASEDIR / "build", check=True):
    """
    Bundle the schemas into a single file.
    """
    ctx.cd(BASEDIR)

    with progress("Bundling", "jsonschema"):
        cmd = "npx jsonschema bundle schemas/mdq.yml -w -r schemas/"
        result = ctx.run(cmd, hide="both")
        if result is None:
            return
    schema = json.loads(result.stdout)

    build = Path(build)
    build.mkdir(parents=True, exist_ok=True)

    with (build / "mdq.schema.json").open("w") as fd:
        schema["$id"] = SCHEMA_CDN + "schema.json"
        json.dump(schema, fd, indent=2)

    with (build / "mdq.min.schema.json").open("w") as fd:
        schema["$id"] = SCHEMA_CDN + "schema.min.json"
        json.dump(schema, fd)

    if check:
        bundled_schema = str(build / "mdq.schema.json")
        with progress("Linting", "jsonschema"):
            ctx.run(f"npx jsonschema lint {bundled_schema}")


@task
def codegen(ctx: Ctx, generate: str = "all", bundle=True, check=False):
    """
    Generate models from JSON schema.

    Args:
        which (str):
            The type of models to generate. Options are 'all', 'pydantic' or 'elm'.
    """
    if bundle:
        globals()["bundle"](ctx, check=check)

    if generate == "all":
        actions = GENERATE_TYPES
    elif generate not in GENERATE_TYPES:
        raise ValueError(f"Invalid option '{generate}'. Choose from {GENERATE_TYPES}.")
    else:
        actions = [generate]

    def pydantic(ctx: Ctx):
        cmd = datamodel_codegen_cmd()
        with progress("Generating models", "pydantic"):
            ctx.run(cmd, pty=False)

        models_py = BASEDIR / "mdq" / "models.py"
        with progress("Post-processing models", "pydantic"):
            src = (models_py).read_text()
            src = post_process_pydantic_module(src)
            models_py.write_text(src)

    def elm(ctx: Ctx):
        cmd = elm_codegen()
        with progress("Generating elm models", "elm"):
            ctx.run(cmd, pty=False)

    for action in actions:
        locals()[action](ctx)


@task
def build(ctx: Ctx, validate=False):
    """Build and validate all schemas."""
    if validate:
        validate(ctx)
    ctx.run("python3 -m build")


@task
def clean(ctx: Ctx, which: str = "all"):
    """Clean up the generated files."""
    if which == "tmp":
        ctx.run("rm -rf .tmp -Rf")


# ===============================================================================
# Helper functions
# ===============================================================================


@contextmanager
def progress(cmd: str, prefix: str = "", justify=60):
    """Echo the command to be run."""
    if prefix:
        msg = f"[bold][ {prefix} ][/bold] {cmd}..."
    else:
        msg = f"{cmd}..."
    print(msg.ljust(justify), end=" ", flush=True)
    try:
        yield
    except Exception:
        print("[bold red][ fail ]", flush=True)
        raise
    else:
        print("[bold green][ done ]", flush=True)


def datamodel_codegen_cmd(
    base_class: str = "pydantic.BaseModel", flags: Mapping[str, Any] = {}
) -> str:
    flag_list = []
    for flag, value in flags.items():
        if flag is False:
            continue
        elif flag is True:
            flag_list.append(f"--{flag}")
        else:
            flag_list.append(f"--{flag}={value}")

    return (
        "uvx --from datamodel-code-generator datamodel-codegen"
        f" --input build/mdq.schema.json"
        f" --output mdq/models.py"
        f" --base-class {base_class}"
        " --input-file-type=jsonschema"
        " --output-model-type=pydantic_v2.BaseModel"
        " --formatters isort"
        " --set-default-enum-member --field-constraints --use-union-operator --use-unique-items-as-set"
        " --capitalise-enum-members --use-default-kwarg --strip-default-none --use-field-description"
        " --collapse-root-models --use-schema-description --use-title-as-name"
        " --use-double-quotes --wrap-string-literal"
        f" {' '.join(flag_list)}"
    )


def post_process_pydantic_module(src: str) -> str:
    """
    Post-process the generated Pydantic module to simplify the models.
    """
    src = src.replace(' | None = ""', ' = ""')
    src = src.replace(" | None = ''", ' = ""')
    src = src.replace(": bool | None", ": bool")
    src = src.replace(": float | None =", ": float =")
    lines = src.splitlines()
    for i, line in enumerate(lines):
        line_lo = line.lower()

        if "| None = '" in line:
            lines[i] = line.replace("| None", "")
        elif "| None = Field(default=" in line and "default=None" not in line:
            lines[i] = line.replace("| None", "")
        elif "| None = Field(default=None" in line:
            continue
        elif "| None" in line and "set[" in line_lo:
            line = line.replace("| None", "")
            if line.endswith("= []"):
                line = line.removesuffix("= []")
            lines[i] = line + "= Field(default_factory=set)"
        elif "| None" in line and "list[" in line_lo:
            line = line.replace("| None", "")
            if line.endswith("= []"):
                line = line.removesuffix("= []")
            lines[i] = line + "= Field(default_factory=lambda: [])"
        elif "| None =" in line:
            lines[i] = line.replace("| None", "")
    lines.append("")
    return "\n".join(lines)


def post_process_elm_openapi_module(openapi: dict[str, Any]) -> dict[str, Any]:
    from mdq.schema.transforms import remove_keys
    from ruamel.yaml import YAML

    with open("schemas/mdq.yml") as fd:
        yaml = YAML(typ="safe")
        blacklist = yaml.load(fd)["$defs"]["private-keys"]
        openapi = remove_keys(openapi, blacklist)

    for model, defs in openapi["components"]["schemas"].items():
        try:
            props = defs["properties"]
        except KeyError:
            continue

        required = defs.setdefault("required", [])
        for prop, prop_def in props.items():
            if "default" in prop_def:
                required.append(prop)
            if prop_def.get("type") == "array":
                required.append(prop)

    return openapi


def elm_codegen(silent=True) -> str:
    from mdq.schema.openapi import openapi_schema_from_model
    from mdq.models import Exam as model

    openapi = openapi_schema_from_model(model)
    openapi = post_process_elm_openapi_module(openapi)

    elm_src = BASEDIR / "elm" / "src"
    tmp_schema = TMPDIR / "mqd-openapi.json"
    tmp_schema.parent.mkdir(parents=True, exist_ok=True)

    with tmp_schema.open("w") as fd:
        json.dump(openapi, fd, indent=2)

    cmd = (
        f"elm-open-api {tmp_schema} --output-dir {elm_src}"
        " --module-name Mdq"
        f" --write-merged-to {tmp_schema.parent / 'elm-openapi.json'}"
    )
    suffix = " > /dev/null 2>&1" if silent else ""
    return cmd + suffix
