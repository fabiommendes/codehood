"""
Defines permission rules for interacting with exams.

The rules use the `rules` library to determine access control for various
exam-related actions, such as viewing, modifying, or responding to exams.
"""

from __future__ import annotations
from typing import TYPE_CHECKING
from django.utils import timezone
import rules

from ..rules import PermEnum
from ..users.rules import instructor

if TYPE_CHECKING:
    from .models import Exam
    from ..users.models import User


@rules.predicate
def exam_owner(user: User, exam: Exam) -> bool:
    """
    User who created the exam.
    """
    return user == exam.owner


@rules.predicate
def enrolled_student(user: User, exam: Exam) -> bool:
    """
    User is an enrolled student in the exam's classroom.
    """
    if exam.classroom is None:
        return False
    return bool(exam.classroom.students.contains(user))


@rules.predicate
def class_staff(user: User, exam: Exam) -> bool:
    """
    User is a staff member of the exam's classroom.
    """
    if exam.classroom is None:
        return False
    return bool(exam.classroom.staff.contains(user))


@rules.predicate
def public_exam(_: User, exam: Exam) -> bool:
    """
    The exam is public and has started.

    Usually, only the owner or staff members can see a non-public exam.
    """
    return exam.has_public_role and exam.start <= timezone.now()


@rules.predicate
def reviewable_exam(user: User, exam: Exam) -> bool:
    """
    Checks if the exam is reviewable by the user.

    Usually the onwer and staff members can review non-public exams.
    """
    return public_exam(user, exam)


@rules.predicate
def exam_is_accepting_responses(_: User, exam: Exam) -> bool:
    """
    Exam is currently accepting responses.
    """
    return exam.is_accepting_responses


@rules.predicate
def can_view_exam(user: User, exam: Exam) -> bool:
    """Checks if the user can view the exam."""
    return rules.has_perm(Perms.VIEW_EXAM, user, exam)


class Perms(PermEnum):
    """
    Defines high-level permissions and bussiness logic
    """

    ADD_EXAM = instructor | class_staff
    VIEW_EXAM = (
        exam_owner | (enrolled_student & public_exam) | (class_staff & reviewable_exam)
    )
    DELETE_EXAM = exam_owner
    CHANGE_EXAM = exam_owner
    RESPOND_IN_EXAM = can_view_exam & exam_is_accepting_responses
