import random

REGITRATION_CODE_SYMBOLS = (
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz123456789@$#-_%&+"
)


def registration_code() -> str:
    """
    Return an 8-letter registration code
    """
    return "".join(random.choice(REGITRATION_CODE_SYMBOLS) for _ in range(8))


def is_natural_public_id(id: str) -> bool:
    """
    Check if the given id is a public natural id, which is in the form
    instructor_edition, where instructor is the username of the instructor
    and edition is the edition of the classroom.
    """
    return "_" in id and not id.startswith("_")


def parse_natural_public_id(id: str) -> tuple[str, str, str]:
    """
    Parse a natural public id into its components.
    """
    prefix, sep, edition = id.rpartition("_")
    if not sep:
        raise ValueError(f"Invalid natural public id: {id}")
    discipline, sep, instructor = prefix.partition("__")
    if not sep:
        raise ValueError(f"Invalid natural public id: {id}")
    return discipline, instructor, edition


def public_id_params(id: str) -> dict[str, str]:
    """
    Returns a dictionary with the discipline and edition as keys.
    """
    if is_natural_public_id(id):
        discipline, instructor, edition = parse_natural_public_id(id)
        return {
            "discipline__slug": discipline,
            "instructor__username": instructor,
            "edition": edition,
        }
    else:
        return {"public_id": id}
