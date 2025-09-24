from django.apps import AppConfig
from django.conf import settings


class CfgConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "codehood.cfg"

    def ready(self):
        modules = []
        for app in settings.INSTALLED_APPS:
            if app.startswith("codehood."):
                for module in ("api", "rpc", "tasks", "rules", "signals"):
                    try:
                        __import__(f"{app}.{module}")
                        modules.append(f"{app}.{module}")
                    except ModuleNotFoundError:
                        pass
