from datetime import datetime
from django.http import JsonResponse
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist

from ninja.errors import ValidationError
from ninja.security.base import AuthBase
from ninja.security import django_auth
from ninja import renderers
from katana import KatanaRPC
from shuriken import ShurikenAPI

from .text import gettext_lazy as _
from .apiauth import UsernamePassword, VeryUnsecure, BearerToken


class JSONEncoder(renderers.NinjaJSONEncoder):
    def default(self, obj):
        # We want non-naive datetimes to be serialized as timestamps since it is
        # both more compact and more accurate than a string representations.
        if isinstance(obj, datetime) and obj.tzinfo is not None:
            return obj.timestamp()

        if isinstance(obj, (set, frozenset)):
            return [self.encode(item) for item in obj]

        return super().default(obj)


class JSONRenderer(renderers.JSONRenderer):
    encoder_class = JSONEncoder


auth_methods: list[AuthBase] = [BearerToken(), django_auth]
if settings.DEBUG:
    auth_methods.append(UsernamePassword())
if settings.UNSECURE_BEARER_AUTH:
    auth_methods.insert(0, VeryUnsecure())


rest = ShurikenAPI(
    title=_("CodeHood REST-ful API"),
    description=_("CodeHood provides a REST-ful API to access most backend resources."),
    auth=[*auth_methods],
    renderer=JSONRenderer(),
)

rpc = KatanaRPC(
    title=_("CodeHood RPC API"),
    description=_(
        """The RPC API implements actions that are not very well modelled as REST. 
It also exposes all data in the rest API as CRUD methods for each resource type."""
    ),
    auth=[*auth_methods],
    renderer=JSONRenderer(),
)


@rpc.exception_handler(ValidationError)
@rest.exception_handler(ValidationError)
def validation_errors(request, exc: ValidationError) -> JsonResponse:
    error, *fields = exc.errors
    if fields:
        error["fields"] = fields
    return JsonResponse(error, status=422)


@rpc.exception_handler(ObjectDoesNotExist)
@rest.exception_handler(ObjectDoesNotExist)
def does_not_exist_error(request, exc: Exception) -> JsonResponse:
    return JsonResponse(
        {
            "error": "not-found",
            "code": 404,
            "message": f"Resource does not exist: {exc}",
        },
        status=404,
    )
