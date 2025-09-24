from __future__ import annotations

import itertools
from typing import TypedDict

from django.db import models
from django.utils import timezone

from ..text import Text
from ..text import gettext_lazy as _
from ..users.models import User

__all__ = ["Profile", "User"]


class Profile(models.Model):
    """
    Social information about users.
    """

    # type Role = User.Role
    Role = User.Role

    class Gender(models.IntegerChoices):
        MALE = 1, _("Male")
        FEMALE = 2, _("Female")
        OTHER = 3, _("Other")

    user: models.OneToOneField[User] = models.OneToOneField(
        to=User,
        verbose_name=_("user"),
        on_delete=models.CASCADE,
        related_name="profile",
    )
    gender = models.SmallIntegerField(
        _("gender"),
        choices=Gender,
        blank=True,
        null=True,
    )
    date_of_birth = models.DateField(
        _("date of birth"),
        blank=True,
        null=True,
        help_text=_("Date of birth is used to compute user's age and birthday"),
    )
    website = models.URLField(
        _("website"),
        blank=True,
        null=True,
        help_text=_("Link to the user's website"),
    )
    bio = models.TextField(
        blank=True,
        help_text=_("A simple user's biography written in Markdown."),
    )
    skills: models.ManyToManyField[Profile, Skill] = models.ManyToManyField(
        "Skill",
        "skills_by",
        help_text=_("Describe your skill-set"),
    )
    mugshot = models.ImageField(
        _("profile picture"),
        blank=True,
        null=True,
        upload_to="profiles/img/",
        help_text=_("A picture to show in profile"),
    )

    @property
    def age(self) -> int | None:
        if (date := self.date_of_birth) is None:
            return None

        today = timezone.now().date()
        years = today.year - date.year

        if (date.month, date.day) > (
            today.month,
            today.day,
        ):
            return years - 1
        else:
            return years

    @property
    def email(self) -> str:
        return self.user.email

    @property
    def name(self) -> str:
        return self.user.name

    @property
    def username(self) -> str:
        return self.user.email

    @property
    def role(self) -> User.Role:
        return self.user.role

    @property
    def school_id(self) -> str:
        return self.user.school_id

    @property
    def github_id(self) -> str:
        return self.user.github_id

    def __str__(self):
        return str(self.user)

    def get_absolute_url(self):
        return f"/{self.user.username}"


class _SkillSchema(TypedDict):
    name: Text
    skills: list[tuple[str, Text]]


class Skill(models.Model):
    """
    Skill model to describe user's skills.
    """

    slug = models.CharField(
        _("id"),
        primary_key=True,
        max_length=50,
        help_text=_("Unique identification string for skill. Used to form URLs."),
    )
    name = models.CharField(
        _("skill description"),
        max_length=50,
        blank=True,
        help_text=_("Description of the skill"),
    )
    description = models.TextField(
        _("skill description"),
        blank=True,
        help_text=_("Description of the skill"),
    )

    SKILL_SETS: dict[str, _SkillSchema] = {
        "programming": {
            "name": _("Programming Languages"),
            "skills": [
                ("python", _("Python")),
                ("java", _("Java")),
                ("javascript", _("JavaScript")),
                ("c++", _("C++")),
                ("c#", _("C#")),
                ("html", _("HTML")),
                ("css", _("CSS")),
                ("sql", _("SQL")),
                ("php", _("PHP")),
                ("ruby", _("Ruby")),
                ("swift", _("Swift")),
                ("go", _("Go")),
                ("typescript", _("TypeScript")),
                ("kotlin", _("Kotlin")),
                ("rust", _("Rust")),
                ("dart", _("Dart")),
                ("r", _("R")),
                ("matlab", _("MATLAB")),
                ("bash", _("Bash")),
                ("shell", _("Shell")),
                ("assembly", _("Assembly")),
                ("lua", _("Lua")),
                ("elixir", _("Elixir")),
                ("scala", _("Scala")),
                ("haskell", _("Haskell")),
                ("groovy", _("Groovy")),
                ("objective-c", _("Objective-C")),
                ("visual-basic", _("Visual Basic")),
                ("perl", _("Perl")),
                ("fortran", _("Fortran")),
                ("pascal", _("Pascal")),
                ("prolog", _("Prolog")),
                ("lisp", _("Lisp")),
                ("clojure", _("Clojure")),
                ("f#", _("F#")),
                ("dart", _("Dart")),
                ("vhdl", _("VHDL")),
                ("verilog", _("Verilog")),
                ("sql", _("SQL")),
                ("pl/sql", _("PL/SQL")),
                ("t-sql", _("T-SQL")),
                ("pl/sql", _("PL/SQL")),
                ("graphql", _("GraphQL")),
                ("json", _("JSON")),
                ("yaml", _("YAML")),
                ("xml", _("XML")),
            ],
        },
        "design": {
            "name": _("Design"),
            "skills": [
                ("photoshop", _("Photoshop")),
                ("illustrator", _("Illustrator")),
                ("figma", _("Figma")),
                ("sketch", _("Sketch")),
                ("invision", _("InVision")),
                ("adobe-xd", _("Adobe XD")),
                ("canva", _("Canva")),
                ("autocad", _("AutoCAD")),
                ("blender", _("Blender")),
                ("3ds-max", _("3ds Max")),
                ("maya", _("Maya")),
            ],
        },
        "management": {
            "name": _("Management"),
            "skills": [
                ("project-management", _("Project Management")),
                ("agile", _("Agile")),
                ("scrum", _("Scrum")),
                ("kanban", _("Kanban")),
                ("lean", _("Lean")),
            ],
        },
    }

    @classmethod
    def populate_common_skills(cls, category: str = "all") -> list[Skill]:
        if category == "all":
            return [
                *itertools.chain(
                    *(
                        cls.populate_common_skills(category)
                        for category in cls.SKILL_SETS
                    )
                )
            ]
        elif category not in cls.SKILL_SETS:
            raise ValueError(
                f"Invalid category '{category}'. Valid categories are: {cls.SKILL_SETS.keys()}"
            )

        skills = cls.SKILL_SETS[category]["skills"]
        return [
            Skill.objects.get_or_create(slug=slug, name=name)[0]
            for slug, name in skills
        ]

    def __str__(self):
        return self.name


from . import signals  # noqa: E402, F401
