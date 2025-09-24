from typing import Any

from factory import Faker, post_generation
from factory.django import DjangoModelFactory

from ..factories import faker
from .models import User

type Field[T] = Faker[Any, T]


class UserFactory(DjangoModelFactory[User]):
    username: Field[str] = Faker("user_name")
    email: Field[str] = Faker("email")
    name: Field[str] = Faker("name")

    @post_generation
    @staticmethod
    def password(obj: User, create: bool, extracted, **kwargs):
        password = (
            extracted
            if extracted
            else faker.password(
                length=32,
                special_chars=True,
                digits=True,
                upper_case=True,
                lower_case=True,
            )
        )
        obj.set_password(password)

    @classmethod
    def _after_postgeneration(cls, instance, create, results=None):
        """Save again the instance if creating and at least one hook ran."""
        if create and results and not cls._meta.skip_postgeneration_save:
            # Some post-generation hooks ran, and may have modified us.
            instance.save()

    class Meta:
        model = User
        django_get_or_create = "email"
