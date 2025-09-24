import random

REGITRATION_CODE_SYMBOLS = (
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz123456789@$#-_%&+"
)


def registration_code() -> str:
    """
    Return an 8-letter registration code
    """
    return "".join(random.choice(REGITRATION_CODE_SYMBOLS) for _ in range(8))
