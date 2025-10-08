from ...api import rest
from .classrooms import (
    classrooms,
    enrolled_classrooms,
    get_queryset,
    view_classroom,
)
from .classrooms import (
    router as classrooms_router,
)
from .disciplines import get_discipline, list_disciplines
from .disciplines import router as disciplines_router

__all__ = [
    "classrooms_router",
    "classrooms",
    "disciplines_router",
    "enrolled_classrooms",
    "get_discipline",
    "get_id",
    "get_queryset",
    "list_disciplines",
    "view_classroom",
]

rest.add_router("/classrooms", classrooms_router)
rest.add_router("/disciplines", disciplines_router)
