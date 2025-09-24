from functools import partial
import random
from typing import Any, Callable, Type
import string

from django.core.exceptions import ImproperlyConfigured
from django.db import models
from django.utils.translation import gettext as _
from django.db.models.fields import NOT_PROVIDED, SmallIntegerField
from model_utils.managers import QueryManager


class DummyChoices(models.IntegerChoices):
    NOT_SET = 0


RANDOM_POOL = string.ascii_letters + string.digits + "-_$+!*"


class StatusField(SmallIntegerField):
    def __init__(self, *args: Any, choices: Type[models.IntegerChoices], **kwargs: Any):
        self.choices_class: Type[models.IntegerChoices] = choices
        kwargs["choices"] = choices
        super().__init__(*args, **kwargs)

        if self.default == NOT_PROVIDED:
            self.default = next(iter(self.choices_class))

    def _prepare_querysets(self, sender: Type[models.Model], **kwargs):
        cls = sender
        declared_fields = {f.attname for f in cls._meta.local_fields}
        for choice in self.choices_class:
            cls.add_to_class(choice.name, QueryManager(status=choice))
            if choice.name in declared_fields:
                raise ImproperlyConfigured(
                    "StatusModel: Model '%s' has a field named '%s' which "
                    "conflicts with a status of the same name." % (cls.__name__, choice)
                )
            cls.add_to_class(choice.name.lower(), QueryManager(status=choice))

    def contribute_to_class(
        self, cls: type[models.Model], name: str, *args, **kwargs
    ) -> None:
        super().contribute_to_class(cls, name, *args, **kwargs)

        if cls._meta.abstract:
            return

        is_status_model_field = self.default is DummyChoices.NOT_SET
        if is_status_model_field and not hasattr(cls, "Status"):
            msg = "To use StatusModel in %s.%s, you must define a Status(IntegerChoices) class in the model namespace."
            msg %= (cls.__module__, cls.__name__)
            raise ImproperlyConfigured(msg)

        if is_status_model_field:
            self.choices_class = cls.Status  # type: ignore
            self.default = list(cls.Status)[0]  # type: ignore
            self.choices = [(choice.name, choice.label) for choice in cls.Status]  # type: ignore

        models.signals.class_prepared.connect(self._prepare_querysets, sender=cls)

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        kwargs["choices"] = self.choices_class
        return name, path, args, kwargs


def public_id(size: int = 8, **kwargs) -> models.CharField[str, str]:
    return models.CharField(
        editable=False,
        unique=True,
        max_length=size,
        default=random_id(size),
        help_text=_("Unique identifier used to construct urls"),
        **kwargs,
    )


def random_id(size: int) -> Callable[[], str]:
    """
    Generate a random ID of given size.
    """
    return partial(gen_random_id, size)


def gen_random_id(size: int) -> str:
    """
    Generate a random ID of given size.
    """
    return "".join(random.choice(RANDOM_POOL) for _ in range(size))
