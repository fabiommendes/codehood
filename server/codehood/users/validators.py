from __future__ import annotations

import re
import typing

from django.core.exceptions import ValidationError

from codehood.text import gettext as _

if typing.TYPE_CHECKING:
    from .models import User


GITHUB_USERNAME_REGEX = re.compile(r"[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}")
SCHOOL_ID_STUDENT_REGEX = re.compile(r"[0-9]{2}\/?[0-9]{5}")
SCHOOL_ID_INSTRUCTOR_REGEX = re.compile(r"\d+$")


def no_at_symbol(username: str) -> None:
    """
    Validator to check if the username does not contain '@'.
    """

    if "@" in username:
        raise ValidationError(
            _("Username cannot contain '@'."),
            params={"value": username},
        )


def github_username(username: str) -> None:
    if not GITHUB_USERNAME_REGEX.match(username):
        raise ValidationError(
            _("Invalid Github account."),
            params={"value": username},
        )


def school_id_for_role(
    role: User.Role,
    school_id: str,
):
    match role:
        case User.Role.INSTRUCTOR:
            if not SCHOOL_ID_INSTRUCTOR_REGEX.match(school_id):
                raise ValidationError(
                    {"school_id": [_("Invalid instructor id.")]},
                    params={"value": school_id},
                )
        case User.Role.STUDENT:
            if not SCHOOL_ID_STUDENT_REGEX.match(school_id):
                raise ValidationError(
                    {"school_id": [_("Invalid student id.")]},
                    params={"value": school_id},
                )
        case User.Role.ADMIN:
            pass
