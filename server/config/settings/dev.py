import builtins

import rich

import config.settings

config.settings.DEBUG = True

from .base import *  # noqa: E402, F403
from .base import (  # noqa: E402
    BASE_DIR,
    DJANGO_APPS,
    LOCAL_APPS,
    MIDDLEWARE,
    THIRD_PARTY_APPS,
)

ALLOWED_HOSTS = ["localhost", "0.0.0.0", "127.0.0.1"]
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
SILKY_PYTHON_PROFILER = True

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# MIDDLEWARE.append(
#     "debug_toolbar.middleware.DebugToolbarMiddleware",
# )
MIDDLEWARE.insert(1, "silk.middleware.SilkyMiddleware")
# MIDDLEWARE.append("pdbr.middlewares.django.PdbrMiddleware")


DEBUG_TOOLBAR_PANELS = [
    "debug_toolbar.panels.history.HistoryPanel",
    "debug_toolbar.panels.versions.VersionsPanel",
    "debug_toolbar.panels.timer.TimerPanel",
    "debug_toolbar.panels.settings.SettingsPanel",
    "debug_toolbar.panels.headers.HeadersPanel",
    "debug_toolbar.panels.request.RequestPanel",
    "debug_toolbar.panels.sql.SQLPanel",
    "debug_toolbar.panels.staticfiles.StaticFilesPanel",
    "debug_toolbar.panels.templates.TemplatesPanel",
    "debug_toolbar.panels.alerts.AlertsPanel",
    "debug_toolbar.panels.cache.CachePanel",
    "debug_toolbar.panels.signals.SignalsPanel",
    "debug_toolbar.panels.redirects.RedirectsPanel",
    "debug_toolbar.panels.profiling.ProfilingPanel",
]

INTERNAL_IPS = ["127.0.0.1"]
SECRET_KEY = "dev"
INSTALLED_APPS = (
    DJANGO_APPS
    # + ["debug_toolbar"]
    + ["corsheaders", "silk", *THIRD_PARTY_APPS]
    + LOCAL_APPS
)


# We can easily set a postmortem debug when things get hairy
def set_postmortem_hook():
    import sys
    import traceback

    import ipdb  # type: ignore

    def _excepthook(exc_type, value, tb):
        traceback.print_exception(exc_type, value, tb)
        print()
        ipdb.pm()

    sys.excepthook = _excepthook


# Patch some functions for quality of life debugging
def dbg(*args, frame=1, short=False, **kwargs):
    import sys

    if not args:
        frame = sys._getframe(frame)
        if short:
            rich.inspect(frame.f_locals, **kwargs)
        else:
            for name, value in frame.f_locals.items():
                rich.inspect(value, title=name)
    elif len(args) == 1:
        rich.inspect(*args, **kwargs)
    else:
        rich.print(*args, **kwargs)


builtins.dbg = dbg  # type: ignore
UNSECURE_BEARER_AUTH = True
