from __future__ import annotations

from datetime import datetime, date, time, timedelta
from typing import TYPE_CHECKING, Iterable, NotRequired, TypedDict
from itertools import repeat

from django.db import models
from django.utils.translation import gettext_lazy as _, gettext as __

from ..classrooms.models import Classroom


class Day(models.IntegerChoices):
    """
    Internally represented as iso week days
    """

    MONDAY = 1, _("Monday")
    TUESDAY = 2, _("Tuesday")
    WEDNESDAY = 3, _("Wednesday")
    THURSDAY = 4, _("Thursday")
    FRIDAY = 5, _("Friday")
    SATURDAY = 6, _("Saturday")
    SUNDAY = 7, _("Sunday")


class TimeSlot(models.Model):
    """
    A weekly appointment for a classroom.
    """

    classroom = models.ForeignKey(
        to=Classroom,
        verbose_name=_("classroom"),
        on_delete=models.CASCADE,
        related_name="time_slots",
    )
    day = models.IntegerField[Day | int, Day](
        _("day of the week"),
        choices=Day.choices,
    )
    start = models.TimeField[time, time](
        _("Start"),
        help_text=_("Initial time for the time slot."),
    )
    end = models.TimeField[time, time](
        _("End"),
        help_text=_("The final time for the time slot."),
    )

    class Meta:
        verbose_name = _("Time Slot")
        verbose_name_plural = _("Time Slots")
        ordering = ["day", "start"]
        constraints = [
            models.constraints.UniqueConstraint(
                fields=["classroom", "day", "start"],
                name="unique_time_slot_for_classroom",
            )
        ]

    def __str__(self):
        start = self.start.strftime("%H:%M")
        end = self.end.strftime("%H:%M")
        day = self.get_day_display()
        return f"{day} {start}–{end}"

    def _cmp_tuple(self):
        return (self.day, self.start, self.end)

    def clean(self):
        if self.start >= self.end:
            raise models.ValidationError(
                _("The start time must be before the end time.")
            )


class Event(models.Model):
    """
    A scheduled event for a classroom.
    """

    time_slot = models.ForeignKey(
        to=TimeSlot,
        verbose_name=_("time slot"),
        on_delete=models.CASCADE,
        related_name="events",
    )
    week = models.IntegerField(
        _("week"),
        help_text=_("the week of the event in the semester"),
    )
    title = models.CharField(
        _("title"),
        max_length=255,
        blank=True,
        help_text=_("the title of the event"),
    )
    description = models.TextField(
        _("description"),
        blank=True,
        help_text=_("the description of the event"),
    )
    start = models.DateTimeField[datetime, datetime](
        _("start"),
        help_text=_("the start date and time of the event"),
    )
    end = models.DateTimeField[datetime, datetime](
        _("end"),
        help_text=_("the end date and time of the event"),
    )
    is_holliday = models.BooleanField[bool, bool](
        _("Holliday"),
        default=False,
        help_text=_(
            "True if the event is a holliday or activities will not be held for any other reason."
        ),
    )

    class Meta:
        verbose_name = _("Event")
        verbose_name_plural = _("Events")
        ordering = ["start"]
        constraints = [
            models.constraints.UniqueConstraint(
                fields=["time_slot", "week"],
                name="unique_time_slot_each_week",
            ),
            models.constraints.UniqueConstraint(
                fields=["time_slot", "start"],
                name="unique_start_for_time_slot",
            ),
            models.constraints.UniqueConstraint(
                fields=["time_slot", "end"],
                name="unique_end_for_time_slot",
            ),
        ]

    def __str__(self):
        data = self.start.strftime("%Y-%m-%d %a %H:%M")
        if self.title:
            data += f" {self.title}"
        return data

    def clean(self):
        if self.start >= self.end:
            raise models.ValidationError(
                _("The start time must be before the end time.")
            )

    def get_title_or_placeholder(self) -> str:
        """
        Return the title of the event.
        """
        return self.title or self._title_placeholder()

    def get_description_or_placeholder(self) -> str:
        """
        Return the description of the event.
        """
        return self.description or __("No description.")

    def _title_placeholder(self) -> str:
        day = self.start.strftime("%x")
        start = self.start.strftime("%X")
        end = self.end.strftime("%X")
        return __("{day}: {start} - {end}").format(day=day, start=start, end=end)


# ==============================================================================
#                          Initialize schedule
# ==============================================================================


class EventSummary(TypedDict):
    title: str
    description: NotRequired[str]


class TimeSlotSummary(TypedDict):
    day: Day
    start: time
    end: NotRequired[time]


def initialize_schedule(
    classroom: Classroom,
    events: Iterable[EventSummary] | None = None,
    skip_dates: dict[date, EventSummary] = {},
    time_slots: Iterable[TimeSlot | TimeSlotSummary] | None = None,
    duration: str = "2:00",
) -> None:
    """
    Initialize the schedule with events and time slots.

    Args:
        events:
            Can be a list of any iterable with dictionaries containing the keys:
            "title" and "description" (optional). This will be used to create events
            in order.
        skip_dates:
            If given, a dictionary mapping dates to skip (e.g., holidays) to
            description dictionaries or strings.
        time_slots:
            The time slots to use for this schedule. Should not be provided if
            the time slots are already set in the database. Otherwise, it can
            be initialized from a dictionary with days as keys and
            TimeSlotSummary as values.
        duration:
            Default duration for each time slot if end time is not provided.
            It defaults to 2 hours written as a string "2:00".
    """
    assert isinstance(classroom.start, date)
    assert isinstance(classroom.end, date)

    if not all(isinstance(x, date) for x in skip_dates):
        types = {str(type(x)) for x in skip_dates}
        raise TypeError(f"skip_dates expect key dates, got {types}")

    # Initialize time slots
    time_slots = initialize_time_slots(classroom, time_slots, duration)
    if not time_slots:
        raise ValueError("No time slots provided. Cannot initialize schedule.")

    # Create an iterator over all events. This will be consumed as we create
    # Event objects in the database.
    if events is None:
        next_event = iter(repeat(EventSummary(title=""))).__next__
    else:
        next_event = iter(events).__next__

    # Now we iterate over dates, producing a new Event object for each
    # time slot possibly creating a holliday for the skipped dates.
    start_of_first_week = classroom.start - timedelta(
        days=classroom.start.isoweekday() - 1
    )
    for event_date, time_slot in iter_time_slots_from(classroom.start, time_slots):
        if event_date > classroom.end:
            break

        is_holliday = False
        if event_date in skip_dates:
            event_data = skip_dates[event_date]
            if isinstance(event_data, str):
                event_data = dict(title=event_data)
            is_holliday = True
        else:
            try:
                event_data = next_event()
            except StopIteration:
                break

        start = datetime.combine(event_date, time_slot.start)
        end = datetime.combine(event_date, time_slot.end)
        week = (event_date - start_of_first_week).days // 7

        defaults = dict(
            time_slot=time_slot,
            week=week,
            start=start.astimezone(classroom.tzinfo),
            end=end.astimezone(classroom.tzinfo),
            is_holliday=is_holliday,
        )
        if classroom.schedule_initialized:
            kwargs = dict(time_slot=time_slot, week=week)
            event, _ = Event.objects.get_or_create(defaults, **kwargs)
        else:
            event = Event(**defaults)

        update_event(event, event_data)
        event.save()

    if not classroom.schedule_initialized:
        classroom.schedule_initialized = True
        classroom.save()


def initialize_time_slots(
    classroom: Classroom,
    time_slots: Iterable[TimeSlot | TimeSlotSummary] | None = None,
    duration: str = "2:00",
) -> list[TimeSlot]:
    data: list[TimeSlot] = []
    if time_slots is None:
        data.extend(classroom.time_slots.all())
    else:
        for time_slot in time_slots:
            if isinstance(time_slot, dict):
                hours, minutes = map(int, duration.split(":"))
                time_slot = create_time_slot(time_slot, classroom, hours, minutes)
            elif not isinstance(time_slot, TimeSlot):
                raise TypeError(f"Invalid time slot type: {type(time_slot)}")
            data.append(time_slot)

    if not time_slots:
        raise ValueError("No time slots provided. Cannot initialize schedule.")

    data.sort(key=lambda x: (x.day, x.start))
    return data


def create_time_slot(
    time_slot: TimeSlotSummary,
    classroom: Classroom,
    hours: int,
    minutes: int,
) -> TimeSlot:
    """
    Create time slots for a schedule.
    """
    day = time_slot["day"]
    start = time_slot["start"]
    if "end" in time_slot:
        end = time_slot["end"]
    else:
        hh, mm = start.hour, start.minute
        hh += hours
        mm += minutes
        end = time(hh, mm)
    return TimeSlot.objects.create(
        classroom=classroom,
        day=day,
        start=start,
        end=end,
    )


def iter_time_slots_from(
    start: date, time_slots: list[TimeSlot]
) -> Iterable[tuple[date, TimeSlot]]:
    """
    Iterate over the time slots from a start date.
    """
    week_start = start - timedelta(days=start.isoweekday() - 1)
    while True:
        for time_slot in time_slots:
            day = week_start + timedelta(days=time_slot.day - 1)
            if day >= start:
                yield day, time_slot
        week_start += timedelta(days=7)


def update_event(event: Event, summary: EventSummary):
    """
    Update the event with the data from the event_data.
    """
    if title := summary.get("title"):
        event.title = title
    if description := summary.get("description"):
        event.description = description


if not TYPE_CHECKING:
    import codehood.schedules  # noqa: E402

    codehood.schedules.initialize_schedule = initialize_schedule
