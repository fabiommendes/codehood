# type: ignore
from pathlib import Path

from invoke import Context as Ctx
from invoke import task

BASE_DIR = Path(__file__).parent
CODEHOOD_DIR = BASE_DIR / "codehood"


@task
def run(ctx):
    """Run the application."""
    ctx.run("python manage.py runserver_plus --nopin", pty=True)


@task
def db(ctx, make_migrations=False):
    """Execute django's 'manage.py migrate'."""
    if make_migrations:
        mm(ctx)
    ctx.run("python manage.py migrate", pty=True)


@task
def mm(ctx):
    """Execute django's 'manage.py makemigrations'."""
    ctx.run("python manage.py makemigrations", pty=True)


@task
def clear_db(ctx, populate=False):
    """Remove auto migrations and than remove the db."""
    clear_migrations(ctx)
    mm(ctx)
    (BASE_DIR / "db.sqlite3").unlink()
    db(ctx)
    ctx.run("python manage.py populate_db all", pty=True)


@task
def clear_migrations(ctx):
    """Remove automatically created migrations."""
    for path in CODEHOOD_DIR.iterdir():
        app_name = path.name.removesuffix(".py")

        if not path.is_dir():
            continue

        migrations = path / "migrations"
        if not migrations.exists():
            continue

        migrations = {p.name[:-3]: p for p in migrations.iterdir() if p.suffix == ".py"}
        del migrations["__init__"]

        # Only the first migration is created. Safely remove, because we can reconstruct it
        # with makemigrations
        # if all(key.endswith("_initial") for key in migrations.keys()):
        #     for key, path in migrations.items():
        #         print(f"removing migration {app_name}/{key}")
        #         path.unlink()
        #     continue

        # Remove the auto migrations
        if migrations:
            print("TODO: remove auto migrations")


@task
def depend(ctx: Ctx, name, env="base"):
    """Add a dependency to the project."""

    base_name = name.partition("[")[0]
    out = ctx.run(f"pip index versions {base_name}", hide=True)
    head, *_ = out.stdout.strip().splitlines()
    name, version = head.rstrip(")").split(" (")
    ctx.run(f"pip install {name}=={version}", pty=True, echo=True)

    requirements = BASE_DIR / "requirements" / f"{env}.txt"

    with open(requirements, "r") as fd:
        data = fd.read()

    if name in data:
        return

    with open(requirements, "w") as fd:
        fd.write(data.rstrip() + f"\n{name}~={version}")
