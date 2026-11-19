"""
Test helper: a stateful fake of one course on the Codehood server.

It answers the endpoints `ch push` reads and writes from a dict per entity
kind, so a second push sees what the first one stored. Each stored entity
carries the `rev` it was sent with and an `updatedAt` from a counter.
`edit` changes an entity the way the web would: new content and a newer
`updatedAt`, same `rev`.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable

import httpx
from pages import page

DISCIPLINE = "cs101"
COURSE = "ada_2026-1"
BASE = f"/api/course/{DISCIPLINE}/{COURSE}"
COLLECTION = "/api/course"

__all__ = ["BASE", "COLLECTION", "FakeCourseServer", "team_json"]


def team_json(
    public_id: str,
    name: str,
    members: Iterable[str] = (),
    *,
    on_time: str | None = None,
    late: str | None = None,
    extended: bool = False,
    size_exception: str | None = None,
    due_at: str = "2026-12-10T21:00:00.000Z",
    author: str | None = None,
) -> dict:
    """
    A team as `GET .../team` lists it: `on_time` and `late` are the shas of
    its deliveries, `author` the username on both.
    """

    def delivery(sha: str | None) -> dict | None:
        if sha is None:
            return None
        return {
            "newSha": sha,
            "createdAt": "2026-12-10T20:00:00.000Z",
            "username": author or next(iter(members), None),
        }

    return {
        "publicId": public_id,
        "name": name,
        "dueAt": due_at,
        "extended": extended,
        "createdAt": "2026-11-01T00:00:00.000Z",
        "members": [
            {"username": username, "name": username.title()} for username in members
        ],
        "delivery": {"onTime": delivery(on_time), "late": delivery(late)},
        "sizeException": size_exception,
    }


class FakeCourseServer:
    """
    The server side of a push, kept in memory.
    """

    def __init__(self) -> None:
        self.course: dict | None = None
        self.resources: dict[str, dict] = {}
        self.time_slots: dict[str, dict] = {}
        self.events: dict[tuple[int, str], dict] = {}
        self.assignments: dict[str, dict] = {}
        #: Assignment slug -> its teams, as `team_json` builds them.
        self.teams: dict[str, list[dict]] = {}
        #: Repository slug -> tree sha, `None` before the first commit.
        self.repositories: dict[str, str | None] = {}
        #: Every request, whole, in order.
        self.requests: list[httpx.Request] = []
        #: Teams per page of a team listing, `None` for one page.
        self.team_page_size: int | None = None
        #: The answer to the next `PUT .../member/...`: status and message.
        self.member_error: tuple[int, str] | None = None
        self.calls: list[tuple[str, str]] = []
        #: Paths whose write answers 500.
        self.failing: set[str] = set()
        self.clock = 0

    def tick(self) -> str:
        self.clock += 1
        return f"2026-02-01T00:{self.clock // 60:02d}:{self.clock % 60:02d}.000Z"

    @property
    def writes(self) -> list[tuple[str, str]]:
        return [call for call in self.calls if call[0] != "GET"]

    def requests_to(self, method: str, path: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.method == method and r.url.path == path]

    def create_assignment(self, slug: str, **changes) -> None:
        """
        An assignment that only the server knows.
        """
        self.assignments[slug] = {
            "slug": slug,
            "title": slug,
            "body": "web",
            "opensAt": None,
            "dueAt": "2026-12-10T21:00:00.000Z",
            "closesAt": None,
            "teamMin": 1,
            "teamMax": 1,
            "teamsLockAt": None,
            "template": None,
            "restrictions": None,
            "rev": "web",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": self.tick(),
            **changes,
        }

    def edit(self, kind: str, key: str | tuple[int, str], **changes) -> None:
        """
        Change an entity as the web does: its `rev` stays, `updatedAt` moves.
        """
        entity = getattr(self, kind)[key]
        entity.update(changes)
        entity["updatedAt"] = self.tick()

    def create_resource(self, slug: str, **changes) -> None:
        """
        A resource that only the server knows.
        """
        self.resources[slug] = {
            "slug": slug,
            "title": slug,
            "description": None,
            "data": {"type": "MD", "content": "web"},
            "event": None,
            "rev": "web",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": self.tick(),
            **changes,
        }

    def transport(self) -> Callable[[httpx.Request], httpx.Response]:
        return self.handle

    def handle(self, request: httpx.Request) -> httpx.Response:
        method, path = request.method, request.url.path
        self.calls.append((method, path))
        self.requests.append(request)
        if method != "GET" and path in self.failing:
            return httpx.Response(500, json={"message": "boom"})
        if path == COLLECTION and method == "PUT":
            return self.put_course(json.loads(request.content))
        if path == BASE and method == "GET":
            if self.course is None:
                return httpx.Response(404, json={"message": "not found"})
            return httpx.Response(200, json=self.course)
        if path.startswith(f"{BASE}/assignment"):
            return self.assignment(request)
        if path == f"{BASE}/repository":
            return self.repository_collection(request)
        if path.startswith(f"{BASE}/repository/"):
            return self.repository_item(request)
        if path == "/api/blob/missing":
            return httpx.Response(200, json={"missing": []})
        if method == "GET" and path in (
            f"{BASE}/question",
            f"{BASE}/exam",
            f"{BASE}/grade-column",
            f"{BASE}/roll-call",
        ):
            return httpx.Response(200, json=page([]))
        if path == f"{BASE}/resource":
            return self.resource_collection(request)
        if path == f"{BASE}/time-slot":
            return self.time_slot_collection(request)
        if path == f"{BASE}/calendar-event":
            return self.event_collection(request)
        if method == "DELETE":
            return self.delete(path)
        raise AssertionError(f"unexpected request: {method} {path}")

    def repository_collection(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json=page([self.repository_json(s) for s in self.repositories]),
            )
        slug = json.loads(request.content)["slug"]
        self.repositories.setdefault(slug, None)
        return httpx.Response(200, json=self.repository_json(slug))

    def repository_item(self, request: httpx.Request) -> httpx.Response:
        slug = request.url.path.removeprefix(f"{BASE}/repository/").split("/")[0]
        if request.method == "DELETE":
            self.repositories.pop(slug, None)
            return httpx.Response(200, json={"deleted": True})
        if request.url.path.endswith("/commit"):
            self.repositories[slug] = f"tree-of-{self.tick()}"
            return httpx.Response(200, json={"head": "abc1234"})
        return httpx.Response(200, json={})

    def repository_json(self, slug: str) -> dict:
        return {
            "slug": slug,
            "title": slug,
            "head": None,
            "tree": self.repositories[slug],
            "message": None,
            "committedAt": None,
            "cloneUrl": f"/git/{slug}",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": self.tick(),
        }

    def assignment(self, request: httpx.Request) -> httpx.Response:
        parts = request.url.path.removeprefix(f"{BASE}/assignment").strip("/")
        slug, _, rest = parts.partition("/")
        method = request.method
        if not slug:
            return httpx.Response(200, json=page(self.assignments.values()))
        known = slug in self.assignments
        if not rest:
            if method == "GET" and known:
                return httpx.Response(200, json=self.assignments[slug])
            if method == "PUT":
                return self.put_assignment(slug, request)
            if method == "DELETE" and known:
                force = request.url.params.get("force") == "true"
                if self.teams.get(slug) and not force:
                    return httpx.Response(
                        409, json={"message": "the assignment has teams"}
                    )
                self.assignments.pop(slug)
                self.teams.pop(slug, None)
                return httpx.Response(200, json={"deleted": True})
            return httpx.Response(404, json={"message": "assignment not found"})
        if not known:
            return httpx.Response(404, json={"message": "assignment not found"})
        return self.team(slug, rest, request)

    def put_assignment(self, slug: str, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        current = self.assignments.get(slug)
        if_match = request.headers.get("If-Match")
        if request.headers.get("If-None-Match") == "*" and current is not None:
            return httpx.Response(412, json={"message": "already exists"})
        if if_match is not None and (
            current is None or if_match != f'"{current["updatedAt"]}"'
        ):
            return httpx.Response(412, json={"message": "stale version"})
        stored = {
            "slug": slug,
            "createdAt": "2026-01-01T00:00:00.000Z",
            **(current or {}),
            **body,
            "updatedAt": self.tick(),
        }
        self.assignments[slug] = stored
        return httpx.Response(200, json=stored)

    def team(self, slug: str, rest: str, request: httpx.Request) -> httpx.Response:
        teams = self.teams.setdefault(slug, [])
        if rest == "team" and request.method == "GET":
            start = int(request.url.params.get("after") or 0)
            size = self.team_page_size or len(teams) or 1
            end = start + size
            return httpx.Response(
                200,
                json=page(teams[start:end], str(end) if end < len(teams) else None),
            )
        parts = rest.split("/")
        found = next((t for t in teams if t["publicId"] == parts[1]), None)
        if found is None:
            return httpx.Response(404, json={"message": "team not found"})
        if len(parts) == 2 and request.method == "PATCH":
            body = json.loads(request.content)
            if "name" in body:
                found["name"] = body["name"]
            if "dueAt" in body:
                found["dueAt"] = body["dueAt"]
                found["extended"] = body["dueAt"] is not None
            return httpx.Response(200, json=found)
        if len(parts) == 4 and parts[2] == "member" and request.method == "PUT":
            if self.member_error is not None:
                status, message = self.member_error
                return httpx.Response(status, json={"message": message})
            username = parts[3]
            for team in teams:
                team["members"] = [
                    m for m in team["members"] if m["username"] != username
                ]
            found["members"].append({"username": username, "name": username.title()})
            return httpx.Response(200, json=found)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    def put_course(self, body: dict) -> httpx.Response:
        from test_cli_push import _course_json

        self.course = _course_json(
            description=body["description"],
            startDate=body["startDate"],
            endDate=body["endDate"],
            rev=body["rev"],
            updatedAt=self.tick(),
        )
        return httpx.Response(200, json=self.course)

    def resource_collection(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=page(self.resources.values()))
        body = json.loads(request.content)
        stored = {
            "createdAt": "2026-01-01T00:00:00Z",
            **body,
            "updatedAt": self.tick(),
        }
        self.resources[body["slug"]] = stored
        return httpx.Response(200, json=stored)

    def time_slot_collection(self, request: httpx.Request) -> httpx.Response:
        from test_cli_push import _timeslot_json

        if request.method == "GET":
            return httpx.Response(200, json=page(self.time_slots.values()))
        body = json.loads(request.content)
        stored = _timeslot_json(
            body["slug"],
            title=body["title"],
            day=body["day"],
            start=body["start"],
            duration=body["duration"],
            updatedAt=self.tick(),
        )
        self.time_slots[body["slug"]] = stored
        return httpx.Response(200, json=stored)

    def event_collection(self, request: httpx.Request) -> httpx.Response:
        from test_cli_push import _calendar_event_json

        if request.method == "GET":
            return httpx.Response(200, json=page(self.events.values()))
        body = json.loads(request.content)
        slot = self.time_slots.get(body["timeSlot"])
        stored = _calendar_event_json(
            body["week"],
            body["timeSlot"],
            kind=body["kind"],
            title=body["title"],
            description=body["description"],
            rev=body["rev"],
            repositories=body["repositories"],
            updatedAt=self.tick(),
        )
        if slot is not None:
            stored["timeSlot"] = {
                key: slot[key] for key in ("slug", "day", "start", "duration")
            }
        self.events[(body["week"], body["timeSlot"])] = stored
        return httpx.Response(200, json=stored)

    def delete(self, path: str) -> httpx.Response:
        parts = path.removeprefix(BASE + "/").split("/")
        if parts[0] == "resource":
            self.resources.pop(parts[1], None)
        elif parts[0] == "time-slot":
            self.time_slots.pop(parts[1], None)
        elif parts[0] == "calendar-event":
            self.events.pop((int(parts[1]), parts[2]), None)
        return httpx.Response(
            200, json={"success": True, "message": "deleted", "deleted": True}
        )
