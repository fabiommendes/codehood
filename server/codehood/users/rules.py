import rules
from .models import User


@rules.predicate
def instructor(user: User) -> bool:
    return user.role == User.Role.INSTRUCTOR


@rules.predicate
def student(user: User) -> bool:
    return user.role == User.Role.STUDENT


@rules.predicate
def admin(user: User) -> bool:
    return user.role == User.Role.ADMIN
