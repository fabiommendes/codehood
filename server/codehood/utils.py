import string


def repr_number(n: int, alphabet: str = string.ascii_uppercase) -> str:
    base = len(alphabet)
    if n == 0:
        return "a"
    digits = []
    while n:
        digits.append(alphabet[int(n % base)])
        n //= base
    return "".join(digits[::-1])
