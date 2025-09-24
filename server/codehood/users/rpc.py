from django.http import HttpRequest

from katana import Router

from ..api import rpc

router = Router()


@router.method()
@router.example(
    "Simple login",
    {
        "email": "user@mail.com",
        "password": "1234-secret",
        "return": ".....",
    },
)
def login(request: HttpRequest, email: str, password: str) -> str:
    """
    Login using e-mail and password.
    """
    return f"{email}:{password}"


rpc.add_router("auth", router)
