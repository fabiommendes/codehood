from __future__ import annotations
from typing import TYPE_CHECKING
import rules

from ..rules import PermEnum
from ..users.rules import instructor, student

if TYPE_CHECKING:
    from .models import Classroom
    from ..users.models import User


@rules.predicate
def class_instructor(user: User, classroom: Classroom):
    return user == classroom.instructor


@rules.predicate
def enrolled_student(user: User, classroom: Classroom) -> bool:
    return bool(classroom.students.contains(user))


@rules.predicate
def class_staff(user: User, classroom: Classroom) -> bool:
    return bool(classroom.staff.contains(user))


enrolled = enrolled_student | class_instructor | class_staff


class Perms(PermEnum):
    ADD_CLASSROOM = instructor
    VIEW_CLASSROOM = enrolled
    DELETE_CLASSROOM = class_instructor
    CHANGE_CLASSROOM = class_instructor
    ENROLL_IN_CLASSROOM = student
