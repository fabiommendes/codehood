"""
Test helper: a real git smart-HTTP server on an ephemeral port.

It wraps `git http-backend` (CGI) over bare repositories the test builds, the
way the Codehood server serves a team's repository: read-only, and only to a
request that carries `Authorization: Bearer <key>`. A request without it
gets a `401` with no `WWW-Authenticate`, so git cannot fall back to asking
for a password. Every request's path and headers are recorded.
"""

from __future__ import annotations

import os
import re
import subprocess
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

__all__ = ["GitHttpServer", "TeamRepo", "git"]

#: `.../team/<publicId>/git/<rest>`
_ROUTE = re.compile(r"^/api/course/[^/]+/[^/]+/assignment/[^/]+/team/([^/]+)/git/(.*)$")

#: Identity for the commits the tests make, whatever the machine's config says.
IDENTITY = {
    "GIT_AUTHOR_NAME": "Student",
    "GIT_AUTHOR_EMAIL": "student@example.edu",
    "GIT_COMMITTER_NAME": "Student",
    "GIT_COMMITTER_EMAIL": "student@example.edu",
}


def git(cwd: Path, *args: str) -> str:
    """
    Run git in `cwd` and return its stdout, failing the test on an error.
    """
    result = subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, **IDENTITY},
    )
    return result.stdout.strip()


class TeamRepo:
    """
    The repository of one team: a work tree the test commits in, and the bare
    repository the server serves, which `commit` pushes to.
    """

    def __init__(self, root: Path, public_id: str) -> None:
        self.public_id = public_id
        self.bare = root / "bare" / public_id
        self.work = root / "work" / public_id
        self.bare.mkdir(parents=True)
        self.work.mkdir(parents=True)
        git(self.bare, "init", "--bare", "--quiet", "-b", "main")
        git(self.work, "init", "--quiet", "-b", "main")
        git(self.work, "remote", "add", "origin", str(self.bare))
        git(self.bare, "config", "http.uploadpack", "true")

    def commit(self, files: dict[str, str], message: str = "work") -> str:
        """
        Commit `files` on `main`, push it to the bare repository, and return
        the sha.
        """
        for name, text in files.items():
            path = self.work / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        git(self.work, "add", "-A")
        git(self.work, "commit", "--quiet", "-m", message)
        git(self.work, "push", "--quiet", "origin", "main")
        return git(self.work, "rev-parse", "HEAD")


@dataclass
class GitHttpServer:
    """
    Serves the repositories of `repos` (by `publicId`) over HTTP.
    """

    key: str
    repos: dict[str, Path] = field(default_factory=dict)
    #: Team ids whose requests answer `401` even with the key.
    refuse: set[str] = field(default_factory=set)
    #: `(path, headers)` of every request, authorized or not.
    requests: list[tuple[str, dict[str, str]]] = field(default_factory=list)
    #: The exit status the server answered, per `(path, status)`.
    statuses: list[tuple[str, int]] = field(default_factory=list)
    _server: ThreadingHTTPServer | None = None

    @property
    def url(self) -> str:
        assert self._server is not None
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def add(self, repo: TeamRepo) -> None:
        self.repos[repo.public_id] = repo.bare

    def start(self) -> None:
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: object) -> None:
                pass

            def do_GET(self) -> None:
                outer.serve(self)

            def do_POST(self) -> None:
                outer.serve(self)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()

    def serve(self, handler: BaseHTTPRequestHandler) -> None:
        path, _, query = handler.path.partition("?")
        headers = {name.lower(): value for name, value in handler.headers.items()}
        self.requests.append((handler.path, headers))
        body = self._body(handler)
        route = _ROUTE.match(path)
        if headers.get("authorization") != f"Bearer {self.key}" or (
            route is not None and route[1] in self.refuse
        ):
            return self._reply(handler, 401, {}, b"unauthorized")
        if route is None or route[1] not in self.repos:
            return self._reply(handler, 404, {}, b"not found")
        root = self.repos[route[1]]
        env = {
            "PATH": os.environ.get("PATH", ""),
            "GIT_PROJECT_ROOT": str(root.parent),
            "GIT_HTTP_EXPORT_ALL": "1",
            "REQUEST_METHOD": handler.command,
            "PATH_INFO": f"/{root.name}/{route[2]}",
            "QUERY_STRING": query,
            "CONTENT_TYPE": headers.get("content-type", ""),
            "CONTENT_LENGTH": str(len(body)),
            "REMOTE_USER": "teacher",
            "REMOTE_ADDR": "127.0.0.1",
        }
        if "content-encoding" in headers:
            env["HTTP_CONTENT_ENCODING"] = headers["content-encoding"]
        if "git-protocol" in headers:
            env["GIT_PROTOCOL"] = headers["git-protocol"]
        result = subprocess.run(
            ["git", "http-backend"],
            input=body,
            capture_output=True,
            check=False,
            env=env,
        )
        head, _, payload = result.stdout.partition(b"\r\n\r\n")
        fields = dict(
            line.split(": ", 1) for line in head.decode().split("\r\n") if ": " in line
        )
        status = int(fields.pop("Status", "200").split()[0])
        self._reply(handler, status, fields, payload)

    def _body(self, handler: BaseHTTPRequestHandler) -> bytes:
        if handler.headers.get("Transfer-Encoding", "").lower() == "chunked":
            chunks = []
            while True:
                size = int(handler.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    handler.rfile.readline()
                    return b"".join(chunks)
                chunks.append(handler.rfile.read(size))
                handler.rfile.readline()
        return handler.rfile.read(int(handler.headers.get("Content-Length") or 0))

    def _reply(
        self,
        handler: BaseHTTPRequestHandler,
        status: int,
        fields: dict[str, str],
        payload: bytes,
    ) -> None:
        self.statuses.append((handler.path, status))
        handler.send_response(status)
        for name, value in fields.items():
            handler.send_header(name, value)
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
