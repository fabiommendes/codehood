# This file is AUTO-GENERATED. DO NOT EDIT!

from __future__ import annotations

from typing import Literal

import httpx
from pydantic import ConfigDict, Field, TypeAdapter

from ..models.base import Model
from .base import CodehoodAPIError, auth_headers, get_client, query_params


class AcceptItem(Model):
    pattern: str
    feedback: str | None = None
    comment: str | None = None


class BlanksItemShortAnswer(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: Literal["short-answer"]
    one_of: list[str] | None = Field(default=None, alias="oneOf")
    regex: str | None = None


class CalendarEventCreate(Model):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["REGULAR", "HOLIDAY", "CANCELLED"] | None = None
    title: str
    description: str | None = None
    week: int
    ref: str
    time_slot: str = Field(alias="timeSlot")


class ChoicesItem(Model):
    id: str | None = None
    text: str
    correct: bool | None = None
    marker: str | None = None
    feedback: str | None = None
    comment: str | None = None


class ChoicesItem2(Model):
    id: str | None = None
    text: str
    correct: bool | None = None
    feedback: str | None = None
    comment: str | None = None


class ChoicesItem3(Model):
    id: str | None = None
    text: str
    score: float | None = None
    feedback: str | None = None
    comment: str | None = None


class CourseCreate(Model):
    model_config = ConfigDict(populate_by_name=True)

    description: str | None = None
    discipline: str
    edition: str
    instructor: str | None = None
    start_at: str | None = Field(alias="startAt")
    end_at: str | None = Field(alias="endAt")


class Data(Model):
    model_config = ConfigDict(populate_by_name=True)

    link: str
    mime_type: str = Field(alias="mimeType")
    filename: str
    type: Literal["FILE"]


class DataCode(Model):
    type: Literal["CODE"]
    content: str
    language: str


class DataFile(Model):
    filename: str
    type: Literal["FILE"]
    buffer: str


class DataLink(Model):
    type: Literal["LINK"]
    url: str


class DataMd(Model):
    type: Literal["MD"]
    content: str


class Deleted(Model):
    success: bool
    message: str
    deleted: bool


class Discipline(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    name: str
    created_at: str = Field(alias="createdAt")


class DisciplineCreate(Model):
    slug: str
    name: str


class Duration(Model):
    hours: int | None = None
    minutes: int | None = None


class Edition(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    name: str
    start_at: str | None = Field(alias="startAt")
    end_at: str | None = Field(alias="endAt")
    created_at: str | None = Field(alias="createdAt")


class Edition2(Model):
    slug: str
    name: str


class EditionCreate(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    name: str
    start_at: str | None = Field(alias="startAt")
    end_at: str | None = Field(alias="endAt")


class HealthResponse(Model):
    status: Literal["ok"]
    database: Literal["ok"]


class Instructor(Model):
    name: str
    username: str


class ListDisciplineResponseItem(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    name: str
    created_at: str = Field(alias="createdAt")


class ListEditionResponseItem(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    name: str
    start_at: str | None = Field(alias="startAt")
    end_at: str | None = Field(alias="endAt")
    created_at: str | None = Field(alias="createdAt")


class ListUserResponseItem(Model):
    username: str
    name: str


class LoginRequest(Model):
    login: str
    password: str


class LoginResponse(Model):
    token: str


class LogoutResponse(Model):
    success: bool


class QuestionEssay(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["essay"]
    input: Literal["code", "text", "plain"] | None = None
    highlight: str | None = None
    answer_key: str | None = Field(default=None, alias="answerKey")


class Start(Model):
    hour: int
    minute: int


class Tolerance(Model):
    absolute: float | None = None
    relative: float | None = None


class UpdateCalendarEventRequest(Model):
    kind: Literal["REGULAR", "HOLIDAY", "CANCELLED"] | None = None
    title: str | None = None
    description: str | None = None
    ref: str | None = None


class UpdateCourseRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    description: str | None = None
    start_at: str | None = Field(default=None, alias="startAt")
    end_at: str | None = Field(default=None, alias="endAt")


class UpdateDisciplineRequest(Model):
    name: str | None = None


class UpdateEditionRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    start_at: str | None = Field(default=None, alias="startAt")
    end_at: str | None = Field(default=None, alias="endAt")


class UpdateUserRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    email: str | None = None
    github_id: str | None = Field(default=None, alias="githubId")
    school_id: str | None = Field(default=None, alias="schoolId")


class UpsertCalendarEventRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["REGULAR", "HOLIDAY", "CANCELLED"] | None = None
    title: str
    description: str | None = None
    week: int
    ref: str
    time_slot: str = Field(alias="timeSlot")


class UpsertCourseRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    description: str | None = None
    discipline: str
    edition: str
    instructor: str | None = None
    start_at: str | None = Field(alias="startAt")
    end_at: str | None = Field(alias="endAt")


class UpsertDisciplineRequest(Model):
    slug: str
    name: str


class UpsertEditionRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    name: str
    start_at: str | None = Field(alias="startAt")
    end_at: str | None = Field(alias="endAt")


class UpsertUserRequest(Model):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    name: str
    username: str
    role: Literal["STUDENT", "INSTRUCTOR", "ADMIN"]
    github_id: str | None = Field(default=None, alias="githubId")
    school_id: str | None = Field(default=None, alias="schoolId")
    password: str


class User(Model):
    username: str
    name: str


class UserCreate(Model):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    name: str
    username: str
    role: Literal["STUDENT", "INSTRUCTOR", "ADMIN"]
    github_id: str | None = Field(default=None, alias="githubId")
    school_id: str | None = Field(default=None, alias="schoolId")
    password: str


class BlanksItemMultipleChoice(Model):
    id: str
    type: Literal["multiple-choice"]
    choices: list[ChoicesItem3]


class BlanksItemNumeric(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: Literal["numeric"]
    answer: float
    unit: str | None = None
    domain: Literal["integer", "decimal", "fraction"] | None = None
    decimal_places: int | None = Field(default=None, alias="decimalPlaces")
    tolerance: Tolerance | None = None


class Course(Model):
    model_config = ConfigDict(populate_by_name=True)

    description: str | None
    discipline: UpsertDisciplineRequest
    edition: Edition2
    instructor: Instructor
    enrollment_count: int = Field(alias="enrollmentCount")
    start_at: str = Field(alias="startAt")
    end_at: str = Field(alias="endAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    joined_at: str = Field(alias="joinedAt")


class ListCourseResponseItem(Model):
    model_config = ConfigDict(populate_by_name=True)

    description: str | None
    discipline: UpsertDisciplineRequest
    edition: Edition2
    instructor: Instructor
    enrollment_count: int = Field(alias="enrollmentCount")
    start_at: str = Field(alias="startAt")
    end_at: str = Field(alias="endAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    joined_at: str = Field(alias="joinedAt")


class ListResourceResponseItem(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    title: str
    description: str | None
    data: DataLink | Data | DataCode | DataMd
    ref: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class QuestionMultipleChoice(Model):
    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["multiple-choice"]
    choices: list[ChoicesItem3]
    shuffle: bool | None = None


class QuestionMultipleSelection(Model):
    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["multiple-selection"]
    choices: list[ChoicesItem2]
    shuffle: bool | None = None


class QuestionNumeric(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["numeric"]
    answer: float
    unit: str | None = None
    domain: Literal["integer", "decimal", "fraction"] | None = None
    decimal_places: int | None = Field(default=None, alias="decimalPlaces")
    tolerance: Tolerance | None = None


class QuestionShortAnswer(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["short-answer"]
    one_of: list[str] | None = Field(default=None, alias="oneOf")
    regex: str | None = None
    accept: list[str | AcceptItem] | None = None
    reject: list[str | AcceptItem] | None = None
    pre_accept: list[str | AcceptItem] | None = Field(default=None, alias="preAccept")
    pre_reject: list[str | AcceptItem] | None = Field(default=None, alias="preReject")
    open_ended: bool | None = Field(default=None, alias="openEnded")


class QuestionTrueFalse(Model):
    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["true-false"]
    choices: list[ChoicesItem]
    shuffle: bool | None = None


class Resource(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    title: str
    description: str | None
    data: DataLink | Data | DataCode | DataMd
    ref: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ResourceCreate(Model):
    slug: str
    title: str
    ref: str
    description: str | None = None
    data: DataLink | DataFile | DataCode | DataMd


class TimeSlot(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    course_id: int = Field(alias="courseId")
    slug: str
    title: str | None
    day: Literal[
        "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    ]
    start: Start
    duration: Duration
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class TimeSlot2(Model):
    slug: str
    day: Literal[
        "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    ]
    start: Start
    duration: Duration


class TimeSlotCreate(Model):
    slug: str
    title: str | None = None
    day: Literal[
        "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    ]
    start: Start
    duration: Duration


class Timeslot(Model):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    course_id: int = Field(alias="courseId")
    slug: str
    title: str | None
    day: Literal[
        "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    ]
    start: Start
    duration: Duration
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class UpdateResourceRequest(Model):
    title: str | None = None
    ref: str | None = None
    description: str | None = None
    data: DataLink | DataFile | DataCode | DataMd | None = None


class UpdateTimeslotRequest(Model):
    title: str | None = None
    day: (
        Literal[
            "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
        ]
        | None
    ) = None
    start: Start | None = None
    duration: Duration | None = None


class UpsertResourceRequest(Model):
    slug: str
    title: str
    ref: str
    description: str | None = None
    data: DataLink | DataFile | DataCode | DataMd


class UpsertTimeslotRequest(Model):
    slug: str
    title: str | None = None
    day: Literal[
        "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
    ]
    start: Start
    duration: Duration


class CalendarEvent(Model):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["REGULAR", "HOLIDAY", "CANCELLED"]
    title: str
    description: str | None
    start_at: str = Field(alias="startAt")
    week: int
    time_slot: TimeSlot2 = Field(alias="timeSlot")
    ref: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ListCalendarEventResponseItem(Model):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["REGULAR", "HOLIDAY", "CANCELLED"]
    title: str
    description: str | None
    start_at: str = Field(alias="startAt")
    week: int
    time_slot: TimeSlot2 = Field(alias="timeSlot")
    ref: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class QuestionFillIn(Model):
    id: str | None = None
    uuid: str | None = None
    title: str | None = None
    author: str | None = None
    stem: str
    preamble: str | None = None
    epilogue: str | None = None
    comment: str | None = None
    locale: str | None = None
    tags: list[str] | None = None
    meta: dict[str, object | None] | None = None
    type: Literal["fill-in"]
    blanks: list[BlanksItemMultipleChoice | BlanksItemShortAnswer | BlanksItemNumeric]
    shuffle: bool | None = None


class ListQuestionResponseItem(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    id: int
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"]
    version: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    question: (
        QuestionMultipleChoice
        | QuestionMultipleSelection
        | QuestionTrueFalse
        | QuestionEssay
        | QuestionNumeric
        | QuestionShortAnswer
        | QuestionFillIn
    )


class Question(Model):
    model_config = ConfigDict(populate_by_name=True)

    slug: str
    id: int
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"]
    version: str
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    question: (
        QuestionMultipleChoice
        | QuestionMultipleSelection
        | QuestionTrueFalse
        | QuestionEssay
        | QuestionNumeric
        | QuestionShortAnswer
        | QuestionFillIn
    )


class QuestionCreate(Model):
    slug: str
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"]
    version: str
    question: (
        QuestionMultipleChoice
        | QuestionMultipleSelection
        | QuestionTrueFalse
        | QuestionEssay
        | QuestionNumeric
        | QuestionShortAnswer
        | QuestionFillIn
    )


class UpdateQuestionRequest(Model):
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"] | None = None
    version: str | None = None
    question: (
        QuestionMultipleChoice
        | QuestionMultipleSelection
        | QuestionTrueFalse
        | QuestionEssay
        | QuestionNumeric
        | QuestionShortAnswer
        | QuestionFillIn
        | None
    ) = None


class UpsertQuestionRequest(Model):
    slug: str
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"]
    version: str
    question: (
        QuestionMultipleChoice
        | QuestionMultipleSelection
        | QuestionTrueFalse
        | QuestionEssay
        | QuestionNumeric
        | QuestionShortAnswer
        | QuestionFillIn
    )


class HealthError(CodehoodAPIError):
    class Payload(Model):
        status: Literal["error"]
        database: Literal["unreachable"]

    payload: Payload

    @property
    def database(self) -> Literal["unreachable"]:
        return self.payload.database


class InvalidCredentials(CodehoodAPIError):
    class Payload(Model):
        type: Literal["error"]
        code: Literal["not-allowed"]
        status: Literal[401]
        message: str
        action: str
        timestamp: str | None

    payload: Payload

    @property
    def type(self) -> Literal["error"]:
        return self.payload.type

    @property
    def code(self) -> Literal["not-allowed"]:
        return self.payload.code

    @property
    def message(self) -> str:
        return self.payload.message

    @property
    def action(self) -> str:
        return self.payload.action

    @property
    def timestamp(self) -> str | None:
        return self.payload.timestamp


def create_calendar_event(
    *,
    discipline: str,
    course: str,
    body: CalendarEventCreate,
    client: httpx.Client | None = None,
) -> CalendarEvent:
    """
    Creates a new Calendar Event.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/course/{discipline}/{course}/calendar-event".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return CalendarEvent.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_course(*, body: CourseCreate, client: httpx.Client | None = None) -> Course:
    """
    Creates a new Course.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/course",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Course.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_discipline(
    *, body: DisciplineCreate, client: httpx.Client | None = None
) -> Discipline:
    """
    Creates a new Discipline.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/discipline",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Discipline.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_edition(
    *, body: EditionCreate, client: httpx.Client | None = None
) -> Edition:
    """
    Creates a new Edition.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/edition",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Edition.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_question(
    *,
    discipline: str,
    course: str,
    body: QuestionCreate,
    client: httpx.Client | None = None,
) -> Question:
    """
    Creates a new Question.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/course/{discipline}/{course}/question".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Question.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_resource(
    *,
    discipline: str,
    course: str,
    body: ResourceCreate,
    client: httpx.Client | None = None,
) -> Resource:
    """
    Creates a new Resource.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/course/{discipline}/{course}/resource".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Resource.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_timeslot(
    *,
    discipline: str,
    course: str,
    body: TimeSlotCreate,
    client: httpx.Client | None = None,
) -> TimeSlot:
    """
    Creates a new TimeSlot.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/course/{discipline}/{course}/time-slot".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TimeSlot.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def create_user(*, body: UserCreate, client: httpx.Client | None = None) -> User:
    """
    Creates a new User.
    """
    client = client if client is not None else get_client()
    response = client.post(
        "/api/user",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return User.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_calendar_event(
    *,
    discipline: str,
    course: str,
    week: str,
    time_slot: str,
    client: httpx.Client | None = None,
) -> Deleted:
    """
    Delete a single Calendar Event by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/course/{discipline}/{course}/calendar-event/{week}/{timeSlot}".format(
            discipline=discipline, course=course, week=week, timeSlot=time_slot
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_course(
    *, discipline: str, course: str, client: httpx.Client | None = None
) -> Deleted:
    """
    Delete a single Course by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/course/{discipline}/{course}".format(
            discipline=discipline, course=course
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_discipline(*, slug: str, client: httpx.Client | None = None) -> Deleted:
    """
    Delete a single Discipline by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/discipline/{slug}".format(slug=slug), headers=auth_headers(client)
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_edition(*, slug: str, client: httpx.Client | None = None) -> Deleted:
    """
    Delete a single Edition by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/edition/{slug}".format(slug=slug), headers=auth_headers(client)
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_question(
    *, discipline: str, course: str, slug: str, client: httpx.Client | None = None
) -> Deleted:
    """
    Delete a single Question by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/course/{discipline}/{course}/question/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_resource(
    *, discipline: str, course: str, slug: str, client: httpx.Client | None = None
) -> Deleted:
    """
    Delete a single Resource by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/course/{discipline}/{course}/resource/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_timeslot(
    *, discipline: str, course: str, slug: str, client: httpx.Client | None = None
) -> Deleted:
    """
    Delete a single TimeSlot by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/course/{discipline}/{course}/time-slot/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def delete_user(*, username: str, client: httpx.Client | None = None) -> Deleted:
    """
    Delete a single User by primary key.
    """
    client = client if client is not None else get_client()
    response = client.delete(
        "/api/user/{username}".format(username=username), headers=auth_headers(client)
    )
    if response.status_code == 200:
        return Deleted.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def health(*, client: httpx.Client | None = None) -> HealthResponse:
    """
    Liveness/readiness probe
    """
    client = client if client is not None else get_client()
    response = client.get("/api/health")
    if response.status_code == 503:
        raise HealthError(
            response.status_code, HealthError.Payload.model_validate(response.json())
        )
    if response.status_code == 200:
        return HealthResponse.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_calendar_event(
    *,
    discipline: str,
    course: str,
    from_: str | None = None,
    to: str | None = None,
    kinds: list[Literal["REGULAR", "HOLIDAY", "CANCELLED"]] | None = None,
    weeks: list[int] | None = None,
    limit: int | None = None,
    client: httpx.Client | None = None,
) -> list[ListCalendarEventResponseItem]:
    """
    Find multiple Calendar Events.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/calendar-event".format(
            discipline=discipline, course=course
        ),
        params=query_params(
            {"from": from_, "to": to, "kinds": kinds, "weeks": weeks, "limit": limit}
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListCalendarEventResponseItem]).validate_python(
            response.json()
        )
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_course(
    *,
    instructor: str | None = None,
    discipline: str | None = None,
    edition: str | None = None,
    client: httpx.Client | None = None,
) -> list[ListCourseResponseItem]:
    """
    Find multiple Courses.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course",
        params=query_params(
            {"instructor": instructor, "discipline": discipline, "edition": edition}
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListCourseResponseItem]).validate_python(
            response.json()
        )
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_discipline(
    *, slugs: list[str] | None = None, client: httpx.Client | None = None
) -> list[ListDisciplineResponseItem]:
    """
    Find multiple Disciplines.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/discipline",
        params=query_params({"slugs": slugs}),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListDisciplineResponseItem]).validate_python(
            response.json()
        )
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_edition(
    *,
    slugs: list[str] | None = None,
    active: bool | None = None,
    client: httpx.Client | None = None,
) -> list[ListEditionResponseItem]:
    """
    Find multiple Editions.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/edition",
        params=query_params({"slugs": slugs, "active": active}),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListEditionResponseItem]).validate_python(
            response.json()
        )
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_question(
    *,
    discipline: str,
    course: str,
    slugs: list[str] | None = None,
    statuses: list[Literal["DRAFT", "PUBLISHED", "ARCHIVED"]] | None = None,
    types: list[
        Literal[
            "multiple-choice",
            "multiple-selection",
            "true-false",
            "essay",
            "numeric",
            "short-answer",
            "fill-in",
        ]
    ]
    | None = None,
    tags: list[str] | None = None,
    public: bool | None = None,
    client: httpx.Client | None = None,
) -> list[ListQuestionResponseItem]:
    """
    Find multiple Questions.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/question".format(
            discipline=discipline, course=course
        ),
        params=query_params(
            {
                "slugs": slugs,
                "statuses": statuses,
                "types": types,
                "tags": tags,
                "public": public,
            }
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListQuestionResponseItem]).validate_python(
            response.json()
        )
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_resource(
    *,
    discipline: str,
    course: str,
    types: list[Literal["LINK", "FILE", "CODE", "MD"]] | None = None,
    slugs: list[str] | None = None,
    client: httpx.Client | None = None,
) -> list[ListResourceResponseItem]:
    """
    Find multiple Resources.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/resource".format(
            discipline=discipline, course=course
        ),
        params=query_params({"types": types, "slugs": slugs}),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListResourceResponseItem]).validate_python(
            response.json()
        )
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_timeslot(
    *,
    discipline: str,
    course: str,
    days: list[
        Literal[
            "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"
        ]
    ]
    | None = None,
    client: httpx.Client | None = None,
) -> list[Timeslot]:
    """
    Find multiple Time Slots.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/time-slot".format(
            discipline=discipline, course=course
        ),
        params=query_params({"days": days}),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[Timeslot]).validate_python(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def list_user(
    *,
    usernames: list[str] | None = None,
    take: int | None = None,
    client: httpx.Client | None = None,
) -> list[ListUserResponseItem]:
    """
    Find multiple Users.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/user",
        params=query_params({"usernames": usernames, "take": take}),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return TypeAdapter(list[ListUserResponseItem]).validate_python(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def login(*, body: LoginRequest, client: httpx.Client | None = None) -> LoginResponse:
    client = client if client is not None else get_client()
    response = client.post(
        "/api/auth/login", json=body.model_dump(mode="json", by_alias=True)
    )
    if response.status_code == 401:
        raise InvalidCredentials(
            response.status_code,
            InvalidCredentials.Payload.model_validate(response.json()),
        )
    if response.status_code == 200:
        return LoginResponse.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def logout(*, client: httpx.Client | None = None) -> LogoutResponse:
    """
    Logs out the current user.
    """
    client = client if client is not None else get_client()
    response = client.post("/api/auth/logout", headers=auth_headers(client))
    if response.status_code == 200:
        return LogoutResponse.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_calendar_event(
    *,
    discipline: str,
    course: str,
    week: str,
    time_slot: str,
    client: httpx.Client | None = None,
) -> ListCalendarEventResponseItem:
    """
    Find a single Calendar Event.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/calendar-event/{week}/{timeSlot}".format(
            discipline=discipline, course=course, week=week, timeSlot=time_slot
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListCalendarEventResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_course(
    *, discipline: str, course: str, client: httpx.Client | None = None
) -> ListCourseResponseItem:
    """
    Find a single Course.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}".format(
            discipline=discipline, course=course
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListCourseResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_discipline(
    *, slug: str, client: httpx.Client | None = None
) -> ListDisciplineResponseItem:
    """
    Find a single Discipline.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/discipline/{slug}".format(slug=slug), headers=auth_headers(client)
    )
    if response.status_code == 200:
        return ListDisciplineResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_edition(
    *, slug: str, client: httpx.Client | None = None
) -> ListEditionResponseItem:
    """
    Find a single Edition.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/edition/{slug}".format(slug=slug), headers=auth_headers(client)
    )
    if response.status_code == 200:
        return ListEditionResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_question(
    *,
    discipline: str,
    course: str,
    slug: str,
    public: bool | None = None,
    client: httpx.Client | None = None,
) -> ListQuestionResponseItem:
    """
    Find a single Question.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/question/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        params=query_params({"public": public}),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListQuestionResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_resource(
    *, discipline: str, course: str, slug: str, client: httpx.Client | None = None
) -> ListResourceResponseItem:
    """
    Find a single Resource.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/resource/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListResourceResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_timeslot(
    *, discipline: str, course: str, slug: str, client: httpx.Client | None = None
) -> Timeslot:
    """
    Find a single TimeSlot.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/course/{discipline}/{course}/time-slot/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Timeslot.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def read_user(
    *, username: str, client: httpx.Client | None = None
) -> ListUserResponseItem:
    """
    Find a single User.
    """
    client = client if client is not None else get_client()
    response = client.get(
        "/api/user/{username}".format(username=username), headers=auth_headers(client)
    )
    if response.status_code == 200:
        return ListUserResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_calendar_event(
    *,
    discipline: str,
    course: str,
    week: str,
    time_slot: str,
    body: UpdateCalendarEventRequest,
    client: httpx.Client | None = None,
) -> ListCalendarEventResponseItem:
    """
    Update a single Calendar Event.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/course/{discipline}/{course}/calendar-event/{week}/{timeSlot}".format(
            discipline=discipline, course=course, week=week, timeSlot=time_slot
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListCalendarEventResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_course(
    *,
    discipline: str,
    course: str,
    body: UpdateCourseRequest,
    client: httpx.Client | None = None,
) -> ListCourseResponseItem:
    """
    Update a single Course.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/course/{discipline}/{course}".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListCourseResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_discipline(
    *, slug: str, body: UpdateDisciplineRequest, client: httpx.Client | None = None
) -> ListDisciplineResponseItem:
    """
    Update a single Discipline.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/discipline/{slug}".format(slug=slug),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListDisciplineResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_edition(
    *, slug: str, body: UpdateEditionRequest, client: httpx.Client | None = None
) -> ListEditionResponseItem:
    """
    Update a single Edition.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/edition/{slug}".format(slug=slug),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListEditionResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_question(
    *,
    discipline: str,
    course: str,
    slug: str,
    body: UpdateQuestionRequest,
    client: httpx.Client | None = None,
) -> ListQuestionResponseItem:
    """
    Update a single Question.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/course/{discipline}/{course}/question/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListQuestionResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_resource(
    *,
    discipline: str,
    course: str,
    slug: str,
    body: UpdateResourceRequest,
    client: httpx.Client | None = None,
) -> ListResourceResponseItem:
    """
    Update a single Resource.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/course/{discipline}/{course}/resource/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListResourceResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_timeslot(
    *,
    discipline: str,
    course: str,
    slug: str,
    body: UpdateTimeslotRequest,
    client: httpx.Client | None = None,
) -> Timeslot:
    """
    Update a single TimeSlot.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/course/{discipline}/{course}/time-slot/{slug}".format(
            discipline=discipline, course=course, slug=slug
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Timeslot.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def update_user(
    *, username: str, body: UpdateUserRequest, client: httpx.Client | None = None
) -> ListUserResponseItem:
    """
    Update a single User.
    """
    client = client if client is not None else get_client()
    response = client.patch(
        "/api/user/{username}".format(username=username),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListUserResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_calendar_event(
    *,
    discipline: str,
    course: str,
    body: UpsertCalendarEventRequest,
    client: httpx.Client | None = None,
) -> ListCalendarEventResponseItem:
    """
    Upsert a single Calendar Event. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/course/{discipline}/{course}/calendar-event".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListCalendarEventResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_course(
    *, body: UpsertCourseRequest, client: httpx.Client | None = None
) -> ListCourseResponseItem:
    """
    Upsert a single Course. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/course",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListCourseResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_discipline(
    *, body: UpsertDisciplineRequest, client: httpx.Client | None = None
) -> ListDisciplineResponseItem:
    """
    Upsert a single Discipline. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/discipline",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListDisciplineResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_edition(
    *, body: UpsertEditionRequest, client: httpx.Client | None = None
) -> ListEditionResponseItem:
    """
    Upsert a single Edition. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/edition",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListEditionResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_question(
    *,
    discipline: str,
    course: str,
    body: UpsertQuestionRequest,
    client: httpx.Client | None = None,
) -> ListQuestionResponseItem:
    """
    Upsert a single Question. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/course/{discipline}/{course}/question".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListQuestionResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_resource(
    *,
    discipline: str,
    course: str,
    body: UpsertResourceRequest,
    client: httpx.Client | None = None,
) -> ListResourceResponseItem:
    """
    Upsert a single Resource. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/course/{discipline}/{course}/resource".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListResourceResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_timeslot(
    *,
    discipline: str,
    course: str,
    body: UpsertTimeslotRequest,
    client: httpx.Client | None = None,
) -> Timeslot:
    """
    Upsert a single TimeSlot. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/course/{discipline}/{course}/time-slot".format(
            discipline=discipline, course=course
        ),
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return Timeslot.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())


def upsert_user(
    *, body: UpsertUserRequest, client: httpx.Client | None = None
) -> ListUserResponseItem:
    """
    Upsert a single User. Creates if it does not exist, update otherwise.
    """
    client = client if client is not None else get_client()
    response = client.put(
        "/api/user",
        json=body.model_dump(mode="json", by_alias=True),
        headers=auth_headers(client),
    )
    if response.status_code == 200:
        return ListUserResponseItem.model_validate(response.json())
    response.raise_for_status()
    raise CodehoodAPIError(response.status_code, Model())
