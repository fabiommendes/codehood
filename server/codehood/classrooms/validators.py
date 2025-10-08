from __future__ import annotations

import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _

from ..constants import FRONTEND_BASE_URLS

CLASSROOM_SUFFIX = re.compile(r"[0-9]{4}(-[0-9])?(-?[A-Za-z0-9]{1,2})?")
FORBIDDEN_DISCIPLINE_SLUGS = FRONTEND_BASE_URLS


def classroom_edition(suffix: str) -> None:
    """
    Validator to check if the classroom directory has a valid suffix.
    """

    if not CLASSROOM_SUFFIX.fullmatch(suffix):
        raise ValidationError(
            _(
                "Valid suffix are of the format YYYY-NAA, where N is a number and A is a letter."
            ),
            params={"value": suffix},
        )


def discipline_slug(slug: str) -> None:
    """
    Validator to check if the discipline slug is valid.
    """

    if slug in FORBIDDEN_DISCIPLINE_SLUGS:
        raise ValidationError(
            _("The code '%(value)s' is not allowed."),
            code="invalid-slug",
            params={"value": slug},
        )
    if "__" in slug:
        raise ValidationError(
            _("The code '%(value)s' cannot contain double underscores."),
            code="invalid-slug",
            params={"value": slug},
        )
