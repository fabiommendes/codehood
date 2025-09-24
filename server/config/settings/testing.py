from .base import *

ALLOWED_HOSTS: list[str] = []
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "testing.sqlite3",
    }
}
PASSWORD_HASHERS = ("django.contrib.auth.hashers.MD5PasswordHasher",)
INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS
