import importlib
import os

from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from codehood.text import gettext_lazy as _


class Command(BaseCommand):
    HANDLED_APPS = [*settings.LOCAL_APPS]
    HANDLED_APPS.remove("codehood.cfg")
    HANDLED_APPS = [app.removeprefix("codehood.") for app in HANDLED_APPS]

    help = _("Load all fixtures from the specified app")

    def add_arguments(self, parser):
        parser.add_argument(
            "app_label",
            type=str,
            default="all",
            help=_(
                "App name to load fixtures from. Use 'all' to load from all apps.",
            ),
        )
        parser.add_argument(
            "--no-data",
            type=bool,
            default=False,
            help=_(
                "Prevent loading data fixtures from apps",
            ),
        )
        parser.add_argument(
            "--clean-db",
            "-c",
            action="store_true",
            help=_(
                "Clean db before loading fixtures",
            ),
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help=_("Do not ask questions"),
        )

    def handle(self, *args, **options):
        app_label = options["app_label"]
        load_data = not options["no_data"]
        clean_db = options["clean_db"]
        ask = not options["noinput"]

        if clean_db:
            self.stdout.write(self.style.WARNING("Cleaning database!"))
            if ask:
                confirm = input(
                    _("Are you sure you want to clean the database? (yes/no): ")
                )
                if confirm.lower() != "yes":
                    self.stdout.write(self.style.ERROR("Database cleaning aborted!"))
                    return

            os.unlink(settings.BASE_DIR / "db.sqlite3")
            call_command("migrate", "--noinput")
            self.stdout.write(self.style.WARNING("Database flush successfull!"))

        if app_label == "all":
            for app in self.HANDLED_APPS:
                self.handle_app(app, load_data)
        else:
            self.handle_app(app_label, load_data)

    def handle_app(self, app_label, load_data):
        try:
            app_config = apps.get_app_config(app_label)
        except LookupError:
            raise CommandError(f"App '{app_label}' not found")

        if load_data:
            self.handle_data_fixtures(app_label, app_config)

        try:
            fixtures_module = importlib.import_module(app_config.name + ".fixtures")
        except ModuleNotFoundError:
            self.stdout.write(
                self.style.WARNING(f"Could not find module {app_config.name}.fixtures")
            )
            return

        try:
            command = fixtures_module.populate_db
        except AttributeError:
            raise CommandError(f"No populate_db function found in {app_label}.fixtures")
        command()
        self.stdout.write(
            self.style.SUCCESS(f"[{app_label}] Computed fixtures loaded successfully.")
        )

    def handle_data_fixtures(self, app_label, app_config):
        fixtures_dir = os.path.join(app_config.path, "fixtures")
        if not os.path.isdir(fixtures_dir):
            return

        fixtures = [f for f in os.listdir(fixtures_dir) if f.endswith(".json")]

        if not fixtures:
            self.stdout.write(
                self.style.WARNING(f"No JSON fixtures found in '{fixtures_dir}'")
            )
            return

        for fixture in fixtures:
            fixture_path = os.path.join(fixtures_dir, fixture)
            self.stdout.write(f"Loading fixture: {fixture}")
            call_command("loaddata", fixture_path)

        self.stdout.write(self.style.SUCCESS("All data fixtures loaded successfully."))
