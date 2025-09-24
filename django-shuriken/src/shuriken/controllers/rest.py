from __future__ import annotations

from dataclasses import dataclass, field
import traceback
from types import FunctionType
from typing import TYPE_CHECKING, Any, Callable, Generic, Iterable, TypeVar, cast
from ninja.pagination import paginate
import typing_inspect  # type: ignore

from django.db import models
from django.http import Http404, HttpRequest, HttpResponse
from ninja import Schema
from ninja.orm.factory import SchemaFactory
from ninja.errors import ConfigError

from ..core import (
    INTERNAL_FIELDS,
    Action,
    ApiKwargs,
    Decorator,
    Route,
    RouteMethod,
    RouteOption,
    RouteOptions,
    get_route_options,
    route_has_options,
    _,
)
from ..api import ApiDecorator, delete, get, patch, post, put
from .base import BaseController, MetaConf as BaseMetaConf
from ..utils import copy_function, popattr

M = TypeVar("M", bound=models.Model)


METHOD_DESCRIPTION = {
    "list": _("List all items in the collection."),
    "create": _("Create a new item."),
    "read": _("Read an specific item."),
    "update": _("Update an specific item, by changing only a few fields."),
    "delete": _("Delete a item."),
    "put": _("Update an specific item, by replacing all of its fields at once."),
}
METHOD_SUMMARY = {
    "list": _("List items."),
    "create": _("Create new item."),
    "read": _("Read item."),
    "update": _("Update item."),
    "delete": _("Delete item."),
    "put": _("Replace an item."),
}
CRUD_TO_HTTP: dict[Action, ApiDecorator] = {
    "list": get,
    "create": post,
    "read": get,
    "update": patch,
    "delete": delete,
    "put": put,
}

# NOTE: Important! List must be the last one to prevent breaking Django Ninja's
# method creation.
METHOD_NAMES: list[Action] = ["create", "read", "update", "delete", "put", "list"]


class RestController(BaseController, Generic[M]):
    def __init_subclass__(cls, **kwargs):
        try:
            meta = popattr(cls, "Meta")
        except AttributeError:
            raise ConfigError("Your class must define a Meta inner class.")
        else:
            cls._meta = MetaConf.from_schema_meta(cls, meta)

        cls.model = cls._meta.model
        super().__init_subclass__(**kwargs)

        cls.registry = (*cls.registry, *cls._create_routes())

    @classmethod
    def _create_routes(cls) -> Iterable[tuple[str, Route, RouteOptions]]:
        """
        Fill in the missing implementation bits for the automatically
        created routes.

        We must:
            * Create the schema for the route
            * Annotate a copy of the base implementation with the right type
              parameters, if necessary.
            * Fill in other optional configurations that we would pass manually
              in the @get/@post/etc decorators.
        """
        factory = SchemaFactory()

        # NOTE: Apparently, the paginate decorator cannot be applied before
        # declaring other methods, hence we force /list to be the last method
        # to be registered.
        #
        # I'm not sure if this bug is on us or on Django Ninja.
        for action in METHOD_NAMES:
            method: FunctionType = getattr(cls, action)
            if method is None or route_has_options(method):
                continue

            schema = cls._create_schema(action, factory)
            options = cls._create_route_options(action, method, schema)
            options["description"] = METHOD_DESCRIPTION[action]
            options["summary"] = METHOD_SUMMARY[action]
            path = options.pop("path")
            decorator = CRUD_TO_HTTP[action](path, **cast(ApiKwargs, options))

            yield (action, *wrap_method(method, decorator))

    @classmethod
    def _create_schema(cls, action: Action, factory: SchemaFactory):
        """
        Return the registered schema for the given action, or create one
        automatically if none is registered.
        """
        if (schema := getattr(cls, f"{action}_schema")) is not None:
            return schema

        meta = cls._meta
        return factory.create_schema(
            cls.model,
            name="{}{}Schema".format(action.title(), meta.model.__name__),
            depth=0,
            fields=meta.fields,
            exclude=meta.exclude,
            optional_fields=meta.fields_optional,
            custom_fields=[],
            base_class=Schema,
        )

    @classmethod
    def _create_route_options(
        cls, action: Action, method: Callable, schema: type[Schema]
    ) -> RouteOption:
        """
        Return a dictionary of options to construct a new function. Most
        options correspond simply to arguments that would be passed to the
        decorator functions @api.get or @api.post
        """
        options: RouteOption = {}
        name = method.__name__
        options["operation_id"] = f"{cls.__module__}.{cls.__name__}.{name}"

        prefix = cls._meta.url_prefix
        label = cls.model._meta.app_label
        model = cls.model._meta.model_name
        options["url_name"] = f"{prefix}_{label}_{model}_{name}"

        # We add the necessary suffix to all paths
        options["path"] = "/" if action in {"create", "list"} else "/{id}"

        # Usually we expect the response to be the model schema, except for
        # lists
        options["response"] = schema if action != "list" else list[schema]  # type: ignore

        # Lists also require pagination
        if action == "list":
            options["decorators"] = [paginate]

        return options

    _meta: MetaConf
    model: type[M]

    # Schema classes are used in each of the views. If not provided, they will
    # be auto-generated.
    create_schema: Schema | None = None
    read_schema: Schema | None = None
    update_schema: Schema | None = None
    delete_schema: Schema | None = None
    put_schema: Schema | None = None
    list_schema: Schema | None = None

    # Default implementations of REST-full CRUD methods
    if not TYPE_CHECKING:

        def create(self, request: HttpRequest, data) -> M:
            data = cast(Schema, data).model_dump(by_alias=True)

            try:
                return self.model._default_manager.create(**data)
            except TypeError as tex:
                tb = traceback.format_exc()
                msg = (
                    "Got a `TypeError` when calling `%s.%s.create()`. "
                    "This may be because you have a writable field on the "
                    "serializer class that is not a valid argument to "
                    "`%s.%s.create()`. You may need to make the field "
                    "read-only, or override the %s.create() method to handle "
                    "this correctly.\nOriginal exception was:\n %s"
                    % (
                        self.model.__name__,
                        self.model._default_manager.name,
                        self.model.__name__,
                        self.model._default_manager.name,
                        self.__class__.__name__,
                        tb,
                    )
                )
                raise TypeError(msg) from tex

        def read(self, request: HttpRequest, id) -> M:
            return self.get_object(request, id, "read")

        def update(self, request: HttpRequest, id, data) -> M:
            object = self.get_object(request, id, "update")
            data = cast(Schema, data).model_dump(exclude_none=True)
            for attr, value in data.items():
                setattr(object, attr, value)
            object.save()
            return object

        def delete(self, request: HttpRequest, id):
            object = self.get_object(request, id)
            object.delete()
            return HttpResponse(status=204)

        def put(self, request: HttpRequest, id, data) -> M:
            object = self.get_object(request, id, "put")
            data = cast(Schema, data).model_dump()
            for attr, value in data.items():
                setattr(object, attr, value)
            object.save()
            return object

        def list(self, request: HttpRequest) -> models.QuerySet[M]:
            return self.get_queryset(request, "list")

    create: RouteMethod | None
    read: RouteMethod | None
    update: RouteMethod | None
    delete: RouteMethod | None
    put: RouteMethod | None
    list: RouteMethod | None

    def get_queryset(
        self, request: HttpRequest, action: Action | None = None, /
    ) -> models.QuerySet[M]:
        """
        Queryset used to filter objects for all RESTful operations.
        """
        manager = self.model._meta.default_manager
        if manager is None:
            raise ValueError("model does not define a default manager")
        return manager.all()

    def get_object(
        self, request: HttpRequest, id, action: Action | None = None, /
    ) -> M:
        """
        Used in detail, patch, delete, and update to focus on an specific object.
        """
        return self.get_queryset(request, action).get(pk=id)

    def get_object_or_404(
        self, request: HttpRequest, id, action: Action | None = None, /
    ) -> M:
        """
        Utility method that returns an object or raises an 404 if it is not found.
        """
        try:
            return self.get_object(request, id, action)
        except self.model.DoesNotExist:  # type: ignore[attr-defined]
            raise Http404("No %s matches the given id." % self.model._meta.object_name)


@dataclass
class MetaConf(BaseMetaConf):
    model: Any
    fields: list[str] | None = None
    exclude: list[str] | None = field(default_factory=list)
    fields_optional: list[str] | None = field(default_factory=list)

    @staticmethod
    def from_schema_meta(cls: type[RestController], meta) -> MetaConf:  # type: ignore[override]
        validate_meta_attrs(set(meta.__dict__.keys()))

        try:
            model = meta.model
        except AttributeError:
            bases = typing_inspect.get_generic_bases(cls)
            for base in bases:
                if base.__origin__ == RestController:
                    (model,) = base.__args__
                    break
            else:
                raise ConfigError("Could not determine the model class for %s" % cls)

        fields = getattr(meta, "fields", None)
        exclude = getattr(meta, "exclude", None)
        fields_optional = getattr(meta, "fields_optional", None)

        assert issubclass(model, models.Model)

        if not fields and not exclude:
            raise ConfigError(
                "Creating a ModelSchema without either the 'fields' attribute"
                " or the 'exclude' attribute is prohibited"
            )

        if fields == "__all__":
            fields = None
        if fields_optional == "__all__":
            fields_optional = None

        base = BaseMetaConf.from_schema_meta(cls, meta, validate=False)
        return MetaConf(
            model=model,
            fields=fields,
            exclude=exclude,
            fields_optional=fields_optional,
            **base.__dict__,
        )


def validate_meta_attrs(fields: set):
    if invalid := fields - MetaConf.__annotations__.keys() - INTERNAL_FIELDS:
        field = next(iter(invalid))
        raise ConfigError(
            "%s is not supported in the 'Meta' class declaration." % field
        )


def wrap_method(
    method: FunctionType, decorator: Decorator
) -> tuple[FunctionType, RouteOptions]:
    route = decorator(copy_function(method))
    route = cast(FunctionType, route)
    res = route, get_route_options(route)
    return res
