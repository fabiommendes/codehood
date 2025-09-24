from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import QuerySet
from django.http import Http404, HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_exempt
from ninja import ModelSchema, Schema
from ninja.errors import ValidationError
from shuriken import BaseController

from ..api import rest
from ..apiauth.models import BearerToken
from ..profiles.models import Profile
from . import models


class SignUp(ModelSchema):
    class Meta:
        model = models.User
        fields = [
            "name",
            "username",
            "email",
        ]

    name: str
    username: str
    email: str
    password: str
    github_id: str
    school_id: str
    signup_code: str | None = None


class Credentials(Schema):
    email: str
    password: str


class User(ModelSchema):
    class Meta:
        model = models.User
        fields = ["name", "username", "role"]


class UserDetail(User):
    email: str
    github_id: str
    school_id: str


class Login(Schema):
    token: str
    message: str
    user: UserDetail
    status: int = 200


@rest.controller("/auth", tags=[_("Authentication")])
class AuthController(BaseController):
    @rest.post("/register", auth=None)
    @rest.decorate(csrf_exempt)
    def register(self, request: HttpRequest, data: SignUp) -> Login:
        """
        Register user and automatically perform login
        """
        errors = {}

        if models.User.objects.filter(username=data.username):
            errors["username"] = _("username exists!")

        if models.User.objects.filter(username=data.email):
            errors["email"] = _("e-mail exists!")

        if errors:
            raise ValidationError([{"error": "registration-error"}, errors])

        user = models.User(
            name=data.name,
            email=data.email,
            username=data.username,
            is_active=True,
            github_id=data.github_id,
            school_id=data.school_id,
            password=data.password,
            role=models.User.Role.STUDENT,
        )

        try:
            user.full_clean()
        except DjangoValidationError as err:
            errors = [{"error": "registration-error"}]
            for k, err in err.error_dict.items():
                for err in err:
                    errors.append({k: err.message})
            raise ValidationError(errors)

        with transaction.atomic():
            user.save()
            user.set_password(data.password)
            Profile.objects.get_or_create(user=user)

        token = BearerToken.objects.get_token(user)
        return Login(
            message=_("Signup successful!"),
            status=200,
            token=token,
            user=UserDetail.from_orm(user),
        )

    @rest.post("/login", auth=None, response=Login)
    @rest.decorate(csrf_exempt)
    def login(self, request: HttpRequest, data: Credentials) -> JsonResponse:
        """
        If the user is authenticated, return

            {
                status: 200,
                token: str,
                message: Text
                user: UserSchema
            }

        Otherwise, return

            {
                code: 401,
                error: "invalid-email" | "invalid-password",
                message: Text
            }
        """
        user = authenticate(request, email=data.email, password=data.password)
        if user:
            token = BearerToken.objects.get_token(user)
            payload = Login(
                message=_("Login successful!"),
                status=200,
                token=token,
                user=UserDetail.from_orm(user),
            )
            response = JsonResponse(payload.model_dump())
        elif models.User.objects.filter(email=data.email):
            error = {
                "error": "invalid-password",
                "message": _("invalid password"),
                "code": 401,
            }
            response = JsonResponse(error, status=401)
        else:
            error = {
                "error": "invalid-email",
                "message": _("no user exists with the given e-mail"),
                "code": 401,
            }
            response = JsonResponse(error, status=401)
        return response

    @rest.post("/logout")
    def logout(self, request):
        return NotImplemented


@rest.controller("/users", tags=[_("User Information")])
class UserController(BaseController):
    """
    Display information about other users.
    """

    @rest.get("/", response=list[User])
    def list(self, request: HttpRequest) -> QuerySet[models.User]:
        """
        The list of valid users.
        """
        return models.User.objects.filter(is_active=True)

    @rest.get("/{username}", response=UserDetail)
    def show(self, request: HttpRequest, username: str) -> Profile:
        """
        Return the complete user profile.
        """
        user = get_object_or_404(models.User, username=username, is_active=True)
        try:
            return user.profile
        except Profile.DoesNotExist:
            raise Http404
