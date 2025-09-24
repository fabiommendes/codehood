from django.apps import AppConfig
from django.conf import settings

from . import conf


class ShurikenConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "shuriken"

    def ready(self):
        if getattr(
            settings,
            "SHURIKEN_AUTO_LOAD_MODULES",
            conf.SHURIKEN_AUTO_LOAD_MODULES,
        ):
            _auto_load_api_modules()


def _auto_load_api_modules():
    for app in settings.INSTALLED_APPS:
        try:
            __import__(f"{app}.api")
        except ImportError:
            pass
