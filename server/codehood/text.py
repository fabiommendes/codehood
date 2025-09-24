import typing

from django.utils.translation import gettext

__all__ = ["gettext", "gettext_lazy", "Text"]

if typing.TYPE_CHECKING:

    class Text(str):
        """
        A type that is used to annotate the return value of a human-readable text.
        """

        def __new__(cls, value: str) -> "Text":
            return super().__new__(cls, value)

    def gettext_lazy(message: str) -> Text:  # type: ignore[misc]
        pass

else:
    from django.utils.translation import gettext_lazy

    type Text = str
