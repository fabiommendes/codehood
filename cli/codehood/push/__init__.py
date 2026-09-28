"""
`codehood push`: sync a course repository's course row, `calendar.md` and
`resources/` to the server. See `dev/specs/to-do/push.md` and
`docs/design/mapping-local-filesystem.md`.

Functional core, imperative shell: `plan.plan_push` is a pure generator
that diffs a `LocalState` against a `ServerState` and yields a plan
(`plan.PushOp`); `run.run_plan` is the only thing here that touches HTTP.
"""

from __future__ import annotations

from .calendar import (
    Allocation,
    Calendar,
    Duration,
    Event,
    EventKind,
    Holiday,
    Section,
    TimeOfDay,
    TimeSlot,
    Weekday,
    allocate,
    parse_calendar,
)
from .errors import CalendarError, QuestionParseError, SlugCollisionError
from .plan import (
    DeleteCalendarEvent,
    DeleteQuestion,
    DeleteResource,
    DeleteTimeSlot,
    LocalState,
    PushOp,
    ServerEvent,
    ServerState,
    UpsertCalendarEvent,
    UpsertCourse,
    UpsertQuestion,
    UpsertResource,
    UpsertTimeSlot,
    WarnTimeSlotPinned,
    plan_push,
)
from .question import AnyQuestion, QuestionFile, question_version, scan_questions
from .resource import (
    CodeData,
    FileData,
    MdData,
    ResourceData,
    ResourceFile,
    content_ref,
    scan_resources,
    slugify,
)
from .run import OpResult, fetch_server_state, run_plan

__all__ = [
    #: Plan
    "LocalState",
    "ServerState",
    "ServerEvent",
    "UpsertCourse",
    "UpsertResource",
    "DeleteResource",
    "UpsertQuestion",
    "DeleteQuestion",
    "UpsertTimeSlot",
    "DeleteTimeSlot",
    "UpsertCalendarEvent",
    "DeleteCalendarEvent",
    "WarnTimeSlotPinned",
    "PushOp",
    "plan_push",
    #: Calendar
    "Calendar",
    "Allocation",
    "Section",
    "Holiday",
    "TimeSlot",
    "TimeOfDay",
    "Duration",
    "Event",
    "EventKind",
    "Weekday",
    "parse_calendar",
    "allocate",
    #: Resources
    "ResourceFile",
    "ResourceData",
    "MdData",
    "CodeData",
    "FileData",
    "slugify",
    "content_ref",
    #: Questions
    "AnyQuestion",
    "QuestionFile",
    "question_version",
    "scan_questions",
    "scan_resources",
    #: Errors
    "SlugCollisionError",
    "QuestionParseError",
    "CalendarError",
    #: Shell
    "OpResult",
    "fetch_server_state",
    "run_plan",
]
