"""
Custom models for the CodeHood project
"""

import enum
import logging
from typing import Any

from django.db import models
from model_utils.fields import MonitorField

from .fields import DummyChoices, StatusField
from .text import gettext_lazy as _

__all__ = ["StatusModel", "LoggingModel", "StatusField"]


class LoggingModel(models.Model):
    """
    Base class for models that need logging capabilities.
    """

    class Meta:
        abstract = True

    class LogLevel(enum.IntEnum):
        DEBUG = logging.DEBUG
        INFO = logging.INFO
        WARNING = logging.WARNING
        ERROR = logging.ERROR
        CRITICAL = logging.CRITICAL

    def log(self, msg: str, level: LogLevel, **kwargs):
        """
        By default, messages are also relayed to the standard logging mechanism.

        Override this method to perform additional actions.
        """
        log = logging.getLogger(type(self).__module__)
        log.log(int(level), msg)

    def log_debug(self, msg: str, **kwargs):
        """
        Log a message at DEBUG level.
        """
        self.log(msg, self.LogLevel.DEBUG, **kwargs)

    def log_info(self, msg: str, **kwargs):
        """
        Log a message at INFO level.
        """
        self.log(msg, self.LogLevel.INFO, **kwargs)

    def log_warning(self, msg: str, **kwargs):
        """
        Log a message at WARNING level.
        """
        self.log(msg, self.LogLevel.WARNING, **kwargs)

    def log_error(self, msg: str, **kwargs):
        """
        Log a message at ERROR level.
        """
        self.log(msg, self.LogLevel.ERROR, **kwargs)

    def log_critical(self, msg: str, **kwargs):
        """
        Log a message at CRITICAL level.
        """
        self.log(msg, self.LogLevel.CRITICAL, **kwargs)


class StatusModel(models.Model):
    """
    Patches django-model-utils to work with integer django.db.models.IntegerChoices values.
    """

    status = StatusField(_("status"), choices=DummyChoices, default=DummyChoices.NOT_SET)  # type: ignore
    status_changed = MonitorField(_("status changed"), monitor="status")

    def save(self, *args: Any, **kwargs: Any) -> None:
        """
        Overriding the save method in order to make sure that
        status_changed field is updated even if it is not given as
        a parameter to the update field argument.
        """
        update_fields = kwargs.get("update_fields", None)
        if update_fields and "status" in update_fields:
            kwargs["update_fields"] = set(update_fields).union({"status_changed"})

        super().save(*args, **kwargs)

    class Meta:
        abstract = True
