from .classrooms import (
    router as classrooms_router,
    get_queryset,
    classrooms,
    view_classroom,
    get_id,
    enrolled_classrooms,
)
from .disciplines import router as disciplines_router, get_discipline, list_disciplines
from ...api import rest

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
