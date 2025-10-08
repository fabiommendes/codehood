from django.utils.translation import gettext as _
from ninja import Router
from ninja.pagination import paginate

from .. import models
from . import schemas

router = Router(tags=[_("Disciplines")])


@router.get("/", response=list[schemas.Discipline])
@paginate
def list_disciplines(request):
    """
    List all disciplines.
    """
    return models.Discipline.objects.all()


@router.get("/{slug}", response=schemas.Discipline)
def get_discipline(request, slug: str):
    """
    Show discipline details.
    """
    return models.Discipline.objects.get(slug=slug)
