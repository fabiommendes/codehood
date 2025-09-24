from enum import EnumDict, EnumType, StrEnum
from typing import Any

import rules
from rules.predicates import Predicate


class PermEnumType(EnumType):
    predicate: Predicate

    def __new__(
        cls,
        name: str,
        bases: tuple[type, ...],
        attrs: dict[str, Any],
        *,
        ruleset=rules.permissions.permissions,
        **kwargs,
    ):
        module = attrs.get("__module__", None)
        if module == __name__:
            return super().__new__(cls, name, bases, attrs, **kwargs)

        app_name = attrs["__module__"].removesuffix(".rules").rpartition(".")[2]
        predicates = {}
        namespace = EnumDict()
        for key, value in attrs.items():
            if isinstance(value, rules.Predicate):
                rule_name = f"{app_name}.{key.lower()}"
                ruleset.add_rule(rule_name, value)
                namespace[key] = rule_name
                predicates[key] = value
            else:
                namespace[key] = value

        new = super().__new__(cls, name, bases, namespace, **kwargs)
        for item in new:
            item.predicate = predicates[item.name]
        return new


class PermEnum(StrEnum, metaclass=PermEnumType):
    """
    Base class for all permission registry enums.
    """
