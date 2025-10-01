import itertools
from functools import cache

from ..classrooms.models import Classroom
from ..questions.fixtures import question
from ..questions.models import Question
from ..utils import repr_number
from .models import Exam

KINDS = itertools.cycle(Exam.Kind)


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
        kind=next(KINDS),
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
