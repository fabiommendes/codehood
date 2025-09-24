import copy
from types import MappingProxyType
from typing import (
    TYPE_CHECKING,
    Callable,
    Container,
    Mapping,
    Protocol,
    Sequence,
    cast,
)

from django.db.models import Model, QuerySet
from django.http import HttpRequest
from django.db import models

from .users.models import User


__all__ = [
    "Tag",
    "TaggableManager",
    "AuthenticatedRequest",
    "Redacted",
    "PaginatedView",
    "redacted",
]

if TYPE_CHECKING:

    class Tag(models.Model):
        name = models.CharField()
        slug = models.SlugField()
        natural_key_fields = ["name"]

        def slugify(self, tag: str, i: int | None = None) -> str: ...

    type Tags = models.Manager[Tag]
    TaggableManager: Callable[[], Tags]

    class AuthenticatedRequest(HttpRequest):
        user: User
else:
    from taggit.models import Tag  # type: ignore[import]
    from taggit.managers import TaggableManager  # type: ignore[import]

    Tags = TaggableManager
    AuthenticatedRequest = HttpRequest


class Redacted[T]:
    """
    A model wrapper that allows to override and exclude fields.

    This is useful to wrap Django models before passing them to Pydantic in
    before serializing.
    """

    def __init__(
        self,
        obj: T,
        *,
        exclude: Container[str] = frozenset(),
        overrides: Mapping = MappingProxyType({}),
        computed: Mapping = MappingProxyType({}),
    ):
        self._obj = obj
        self._exclude = exclude
        self._overrides = overrides
        self._computed = computed

    def __getattr__(self, name: str):
        if name.startswith("_") or name in self._exclude:
            raise AttributeError(
                f"'{self.__class__.__name__}' object has no attribute '{name}'"
            )
        try:
            return self._overrides[name]
        except KeyError:
            pass

        try:
            return self._computed[name](self._obj)
        except KeyError:
            pass

        return getattr(self._obj, name)


class PaginatedView[T: Model](Sequence[T]):
    """A Sequence that offers a view to some specific part of a queryset.

    It can be sliced and iterated as normal, but only allow changes to the
    part focused by the view. This is useful to transform a queryset in a way
    that do not break expectations of paginators.
    """

    class Info(Protocol):
        offset: int
        limit: int

    def __init__(
        self,
        queryset: QuerySet[T],
        info: Info | None = None,
        *,
        offset: int = 0,
        limit: int | None = None,
    ):
        if info:
            offset = info.offset
            limit = info.limit
        if limit is None:
            raise TypeError("Limit must be set via argument or Info object.")

        self._queryset = queryset
        self._start: int = offset
        self._end: int = offset + limit
        self._data = list(queryset[self._start : self._end])

    def __getitem__(self, index: int) -> T | Sequence[T] | QuerySet[T]:  # type: ignore[override]
        if isinstance(index, int):
            return self._get_item_by_index(index)
        if isinstance(index, slice):
            indices = index.indices(len(self._queryset))
            return self._get_item_by_slice(*indices)
        raise TypeError("Index must be an int or a slice")

    def _get_item_by_index(self, index: int) -> T:
        if index < 0:
            raise IndexError("Negative index not supported")
        if not index < self._start or index >= self._end:
            return self._queryset[index]
        return self._data[index - self._start]

    def _get_item_by_slice(
        self, start: int, stop: int, step: int
    ) -> Sequence[T] | QuerySet[T]:
        if step != 1:
            raise ValueError("Steps are not supported")
        if start < 0 or stop < 0:
            raise IndexError("Negative index not supported")
        if stop < start:
            raise IndexError("Stop index must be greater than start index")

        # View inside data
        if start >= self._start and stop <= +self._end:
            return self._data[start - self._start : stop - self._start]

        # View completely outside data
        if start < self._start and stop < self._start or start >= self._end:
            return self._queryset[start:stop]

        # View partially inside data
        new = copy.copy(self)
        new._start = start
        new._end = self._end - start
        new._queryset = self._queryset[new._start : new._end]

        data_start = max(0, start - self._start)
        data_size = min(len(self._data), new._end - start - data_start)
        new._data = self._data[data_start : data_start + data_size]
        return new

    def __setitem__(self, index: int, value: T):
        if not index >= self._start and index < self._start + self._end:
            raise IndexError("Index out of range, cannot change value outside the view")
        self._data[index - self._start] = value

    def __len__(self) -> int:
        return len(self._queryset)

    def __iter__(self):
        yield from self._queryset[: self._start]
        yield from self._data
        yield from self._queryset[self._start + self._end :]

    def apply_to_view(self, func: Callable[[T], T]):
        """
        Apply function in all elements in the view.
        """
        self._data[:] = (func(item) for item in self._data)


def redacted[T](
    obj: T,
    exclude: Container[str] = frozenset(),
    overrides: Mapping = MappingProxyType({}),
    computed: Mapping = MappingProxyType({}),
) -> T:
    """
    Create a redacted object, but fools the typechecker that it is of the same
    type as the original object.
    """
    new = Redacted(obj, exclude=exclude, overrides=overrides, computed=computed)
    return cast(T, new)
