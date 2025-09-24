from random import choice
from string import ascii_uppercase

SYMBOLS = set(ascii_uppercase + "".join(map(str, range(10))))
SIMILAR = {
    "I": "1",
    "0": "0",
    "S": "5",
}
SYMBOLS -= SIMILAR.keys()
TRANSLATION = str.maketrans(SIMILAR)


def normalize_passphase(phrase: str) -> str:
    """
    Normalize easily confused letters
    """
    return phrase.translate(TRANSLATION)


def random_passphrase():
    """
    Return a random passphrase used to subscribe to a classroom.
    """
    return "".join(choice(SYMBOLS) for _ in range(6))
