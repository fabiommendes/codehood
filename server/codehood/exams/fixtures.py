from functools import cache
import itertools

from ..classrooms.models import Classroom
from .models import Exam
from ..questions.fixtures import question
from ..questions.models import Question
from ..utils import repr_number


ROLES = itertools.cycle(Exam.Role)


@cache
def exam(
    classroom: Classroom,
    index: int = 1,
    questions: tuple[Question] | int = 5,
    **kwargs,
) -> Exam:
    suffix = repr_number(classroom.id)
    defaults = dict(
        classroom=classroom,
        owner=classroom.instructor,
        slug=f"exam-{index}{suffix}",
        title=f"Exam {index}{suffix}",
        description=f"Exam {index}{suffix} description",
        role=next(ROLES),
    )
    defaults.update(kwargs)
    exam = Exam.objects.create(**defaults)

    if isinstance(questions, int):
        for i in range(1, questions + 1):
            question(exam, i)
    else:
        for qst in questions:
            qst.exam = exam
            qst.save()

    return exam


def populate_db():
    pass  # used by classrooms.fixtures
