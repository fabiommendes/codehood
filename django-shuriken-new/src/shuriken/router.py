from dataclasses import dataclass
from django.shortcuts import get_object_or_404
from ninja.router import Router as BaseRouter
from ninja import Schema, ModelSchema
from django.http import HttpRequest as Request
from django.core.exceptions import ImproperlyConfigured
from django.db.models import QuerySet, Model as DjangoModel


class Router(BaseRouter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

@dataclass
class HttpRouterMeta:
    path: str = "/"
    methods: list[str] = None
    

class HttpRouter(Router):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        
        # Register HTTP verb methods
        http_verbs = {
            "get": self.get,
            "post": self.post,
            "put": self.put,
            "delete": self.delete,
            "patch": self.patch,
            "head": lambda path, **kwargs: lambda fn: self.add_api_operation(path, ["HEAD"], fn, **kwargs),
            "options": lambda path, **kwargs: lambda fn: self.add_api_operation(path, ["OPTIONS"], fn, **kwargs),
        }
        for name in dir(self):
            if name.startswith("http_"):
                verb = name[5:].lower()
                if verb not in http_verbs:
                    raise ImproperlyConfigured(f"Invalid HTTP verb method derived from {name}: {verb.upper()}")
                
                method = getattr(self, name)
                if not callable(method):
                    raise ImproperlyConfigured(f"HTTP verb method {name} is not callable")
                
                http_verbs[verb]("/")(method)
    

class ModelRouterMeta[M: DjangoModel, S: Schema]:
    model:  type[M]= DjangoModel
    abstract: bool = False
    pk: str = "id"


class CRUDRouter[M: DjangoModel, S: Schema = Schema](Router):
    _meta: ModelRouterMeta[M, S]
    
    def queryset(self) -> QuerySet[M]:
        return self._meta.model.objects.all()

    def create(self, request: Request, playload: S) -> M | S:
        fields = playload.dict()
        instance = self._meta.model.objects.create(**fields)
        return instance

    def put(self, request: Request, id: int, playload: S) -> M | S:
        fields = playload.dict()
        kwargs = {self._meta.pk: id}
        instsance, _ = self._meta.model.objects.get_or_create(fields, **kwargs)
        return instsance

    def read(self, request: Request, id: int) -> M | S:
        instance = self._meta.model.objects.get(**{self._meta.pk: id})
        return instance

    def update(self, request: Request, id: int, playload: S):
        instance = get_object_or_404(self._meta.model, **{self._meta.pk: id})
        for attr, value in playload.dict().items():
            setattr(instance, attr, value)
        instance.save()
        return instance

    def delete(self, request: Request, id: int):
        object = get_object_or_404(self._meta.model, **{self._meta.pk: id})
        object.delete()
        return {"success": True}

    def list(self, request: Request) -> list[M] | list[S] | QuerySet[M]:
        return self.queryset()

    



    