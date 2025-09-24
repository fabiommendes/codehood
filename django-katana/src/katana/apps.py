from django.apps import AppConfig
from django.conf import settings

from . import conf


class KatanaConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "katana"

    def ready(self):
        if getattr(settings, "KATANA_AUTO_LOAD_MODULES", conf.KATANA_AUTO_LOAD_MODULES):
            _auto_load_rpc_modules()


def _auto_load_rpc_modules():
    for app in settings.INSTALLED_APPS:
        try:
            __import__(f"{app}.rpc")
        except ImportError:
            pass
