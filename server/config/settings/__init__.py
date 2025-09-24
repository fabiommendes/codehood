"""
For more information on this file, see
https://docs.djangoproject.com/en/5.1/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/5.1/ref/settings/
"""

import os
from pathlib import Path

import django_stubs_ext
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv


django_stubs_ext.monkeypatch()


def env(value: str, default=None):
    try:
        return os.environ[value]
    except KeyError:
        if default is not None:
            return default
        raise ImproperlyConfigured(f"Must set the {value} environment variable.")


# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent.parent

if (
    os.environ.get("DJANGO_SETTINGS_MODULE", "config.settings.dev")
    != "config.settings.dev"
):
    load_dotenv()


# Security
DEBUG = env("DEBUG", False)
SECRET_KEY = "insecure-key"
