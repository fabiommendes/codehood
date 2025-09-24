from functools import cache
from .models import User


def admin(index: int = 0) -> User:
    return user(
        "admin",
        index,
        role=User.Role.ADMIN,
        school_id="admin{index:03}",
        is_staff=True,
        is_superuser=True,
    )


def instructor(index: int = 0) -> User:
    return user("instructor", index, role=User.Role.INSTRUCTOR, school_id="1{index:07}")


def student(index: int = 0) -> User:
    return user("student", index)


@cache
def user(
    name: str, index: int = 0, school_id="00/{index:07}", password=None, **kwargs
) -> User:
    if index == 0:
        suffix = ""
        email = f"{name}@{name}.com"
    else:
        suffix = f"-{index}"
        email = f"{name}{suffix}@{name}.com"

    kwargs.setdefault("role", User.Role.STUDENT)
    kwargs.setdefault("is_active", True)
    user = User.objects.create(
        name=name.title() + suffix,
        username=name + suffix,
        email=email,
        school_id=school_id.format(name=name, index=index, suffix=suffix),
        github_id=name + suffix,
        **kwargs,
    )
    password = name if password is None else password
    user.set_password(password)
    user.save()
    return user


def populate_db():
    admin()
    instructor()
    instructor(1)
    for i in range(0, 11):
        student(i)
