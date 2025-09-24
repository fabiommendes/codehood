import datetime
import random
from functools import cache

from ..exams.fixtures import exam
from ..users.fixtures import instructor, student
from ..users.models import User
from .models import Classroom, Discipline


@cache
def discipline(index=0) -> Discipline:
    suffix = f"-{index}" if index else ""
    suffix_title = suffix.replace("-", " ")
    return Discipline.objects.create(
        name=f"Discipline{suffix_title}",
        slug=f"discipline{suffix}",
    )


@cache
def classroom(
    index=0,
    enrollment=0.0,
    exams: int = 2,
    **kwargs,
) -> Classroom:
    defaults = dict(
        discipline=discipline(index),
        instructor=instructor(index),
        edition="2025-1",
        start=datetime.date.today(),
        end=datetime.date.today() + datetime.timedelta(days=30),
        description="A classroom for testing purposes",
    )
    defaults.update(kwargs)
    classroom = Classroom.objects.create(**defaults)

    if enrollment > 0:
        for user in User.objects.filter(role=User.Role.STUDENT):
            if random.random() < enrollment:
                classroom.enroll_student(user)

    # Fill the classroom with exams and questions
    for i in range(1, exams + 1):
        exam(classroom, index=i)

    return classroom


def default_classroom() -> Classroom:
    return classroom(enrollment=1.0, public_id="abcd1234", exams=10)


def populate_db():
    default = default_classroom()
    default.enroll_student(student())
    classroom(edition="2024-1", enrollment=0.5, status=Classroom.Status.ARCHIVED)
    classroom(edition="2026-1", status=Classroom.Status.PRIVATE)
    other = classroom(1, enrollment=0.5)
    other.enroll_student(student())
