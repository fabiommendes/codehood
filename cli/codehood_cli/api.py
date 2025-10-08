import datetime
from dataclasses import dataclass
from json import JSONEncoder as BaseJSONEncoder
from json import dumps as dump_json
from typing import Any

import requests
from pydantic import BaseModel

from .classroom import Slug
from .config import Config
from .data import Classroom, Discipline, Profile


class JsonEncoder(BaseJSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, BaseModel):
            return o.model_dump()
        if isinstance(o, datetime.datetime):
            return o.timestamp()
        if isinstance(o, datetime.date):
            return o.isoformat()
        return super().default(o)


@dataclass
class NotFound(Exception):
    message: str
    endpoint: str
    status_code = 404


def HTTP_METHOD[T = Any](
    method: str,
    output: type[T],
    cfg: Config,
    endpoint: str,
    headers: dict[str, str] = {},
    **kwargs,
) -> T:
    response = requests.request(
        method,
        f"{cfg.server.url}/api/v1/{endpoint}",
        headers={"Authorization": f"Bearer {cfg.user.token}", **headers},
        **kwargs,
    )
    try:
        response.raise_for_status()
    except requests.HTTPError as e:
        if response.status_code == 404:
            raise NotFound(message=str(e), endpoint=endpoint) from e

        print(response.request.body)
        print(response.text)
        exit()
        raise RuntimeError()

    data = response.json()
    if output in (Any, object):
        return data
    if issubclass(output, BaseModel):
        return output.model_validate(data)
    if not isinstance(data, output):
        raise TypeError(f"Expected {output}, got {type(data)}")
    return data


def GET[T = Any](output: type[T], cfg: Config, endpoint: str) -> T:
    return HTTP_METHOD("GET", output, cfg, endpoint)


def POST[T = Any](
    output: type[T], cfg: Config, endpoint: str, json: dict | BaseModel | None
) -> T:
    kwargs = {}
    if isinstance(json, BaseModel):
        json = json.model_dump()

    if json is not None:
        kwargs["headers"] = {"Content-Type": "application/json"}
        kwargs["data"] = dump_json(json, cls=JsonEncoder)
    return HTTP_METHOD("POST", output, cfg, endpoint, **kwargs)


class account:
    @staticmethod
    def profile(cfg: Config) -> Profile:
        return GET(Profile, cfg, "account/profile")


class disciplines:
    @staticmethod
    def get(cfg: Config, id: str) -> Profile:
        return GET(Discipline, cfg, f"disciplines/{id}")


class classrooms:
    @staticmethod
    def get(cfg: Config, **kwargs) -> Classroom:
        match kwargs:
            case {"id": id}:
                pass
            case {"slug": slug}:
                slug: Slug
                id = f"{slug.discipline}__{cfg.user.username}_{slug.edition}"
            case {
                "discipline": discipline,
                "instructor": instructor,
                "edition": edition,
            }:
                id = f"{discipline}__{instructor}_{edition}"
            case _:
                raise ValueError(f"Invalid keys: {set(kwargs)}")

        return GET(Classroom, cfg, f"classrooms/{id}")

    @staticmethod
    def create(cfg: Config, classroom: Classroom) -> Classroom:
        payload = {
            "edition": classroom.edition,
            "description": classroom.description,
            "discipline": classroom.discipline,
            "timezone": classroom.timezone,
            "start": classroom.start,
            "end": classroom.end,
            "status": classroom.status,
        }
        return POST(Classroom, cfg, "classrooms/", json=payload)
