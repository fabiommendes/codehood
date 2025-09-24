from django.utils.translation import gettext as _
from ninja.pagination import paginate
from ninja import Router


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


@router.get("/{id}", response=schemas.Discipline)
def get_discipline(request, id: str):
    """
    Show discipline details.
    """
    return models.Discipline.objects.get(slug=id)
