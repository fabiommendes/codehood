from functools import cache
from datetime import date, timedelta, time

from ..classrooms.models import Classroom
from .models import initialize_schedule, Day


lorem_ipsum = """
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor 
incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis 
nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
"""


@cache
def schedule(
    classroom: Classroom,
    start: date | None = None,
    duration_days: int = 30,
    days: tuple[Day, ...] = (Day.MONDAY, Day.TUESDAY),
    hours: tuple[time, time] = (time(8, 0), time(10, 0)),
):
    if start is None:
        start = date.today()

    return initialize_schedule(
        classroom,
        events=(
            dict(
                title=f"Activity {n}",
                description=f"Description for activity {n}\n\n{lorem_ipsum}",
            )
            for n in range(duration_days)
        ),
        time_slots=[
            {"day": day, "start": start, "end": end}
            for day in days
            for start, end in [hours]
        ],
        skip_dates={
            start + timedelta(days=3 * n): {"title": f"**Holliday {n}**"}
            for n in range(duration_days // 4)
        },
    )


def populate_db():
    from ..classrooms.fixtures import default_classroom

    schedule(default_classroom())
    for cls in Classroom.objects.filter(schedule_initialized=False):
        schedule(cls)
