import datetime
import mimetypes
from pathlib import Path

from django.core.files.storage import Storage
from django.http import HttpRequest
from django.utils.translation import gettext as _
from ninja import Schema
from shuriken import BaseController, api_error

from codehood.api import rest
from . import FileKind, get_user_storage, highlight_mode


class FileSummarySchema(Schema):
    path: str
    kind: FileKind
    url: str
    mimetype: str | None
    highlight_mode: str | None


class FileInfoSchema(FileSummarySchema):
    created: datetime.datetime
    accessed: datetime.datetime
    modified: datetime.datetime
    size: int


class SourceSchema(Schema):
    path: str
    mimetype: str | None
    highlight_mode: str | None
    content: str


@rest.controller("/files", tags=[_("Files")])
class FilesController(BaseController):
    @rest.get("/list")
    def listdir(self, request: HttpRequest, path: str = "/") -> list[FileSummarySchema]:
        """
        List all files in the given directory.
        """
        content: list[FileSummarySchema] = []
        base, storage = self._get_base_storage(request, path)

        try:
            directories, files = storage.listdir("")
        except FileNotFoundError:
            self._file_not_found(base)
        except NotADirectoryError:
            self._not_a_directory(base)

        for name in directories:
            sub_path = str(base / name)
            schema = FileSummarySchema(
                path=sub_path,
                kind=FileKind.DIRECTORY,
                url=storage.url(sub_path),
                mimetype=None,
                highlight_mode=None,
            )
            content.append(schema)

        for name in files:
            sub_path = str(base / name)
            mime, encoding = mimetypes.guess_file_type(sub_path)
            schema = FileSummarySchema(
                path=sub_path,
                kind=FileKind.from_mime_encoding(mime, encoding),
                url=storage.url(sub_path),
                mimetype=mime,
                highlight_mode=highlight_mode(mime),
            )
            content.append(schema)
        return content

    @rest.get("/info")
    def info(self, request: HttpRequest, path: str) -> FileInfoSchema:
        """
        Show additional details about a given file or directory.
        """
        base, storage = self._get_base_storage(request, path)
        path = str(base)

        try:
            size = storage.size("")
            if self._is_dir(storage, path):
                kind = FileKind.DIRECTORY
                mime = encoding = None
                size = 0
                url = storage.url("")
            else:
                mime, encoding = mimetypes.guess_file_type(path)
                kind = FileKind.from_mime_encoding(mime, encoding)
                url = storage.url("").removesuffix("/")

            return FileInfoSchema(
                path=path,
                kind=kind,
                url=url,
                mimetype=mime,
                highlight_mode=highlight_mode(mime),
                created=storage.get_created_time(""),
                modified=storage.get_modified_time(""),
                accessed=storage.get_accessed_time(""),
                size=size,
            )
        except FileNotFoundError:
            raise self._file_not_found(base)

    @rest.get("/source")
    def source(self, request: HttpRequest, path: str) -> SourceSchema:
        """
        Return the source of a text base file.
        """
        base, storage = self._get_base_storage(request, path)
        path = str(base)

        try:
            with storage.open("", mode="r") as fd:
                content = fd.read()

            mime, _ = mimetypes.guess_file_type(path)

            return SourceSchema(
                path=path,
                mimetype=mime,
                highlight_mode=highlight_mode(mime),
                content=content,
            )
        except FileNotFoundError:
            raise self._file_not_found(base)

    def _is_dir(self, storage: Storage, path: str) -> bool:
        try:
            return bool(storage.listdir(path))
        except NotADirectoryError:
            return False

    def _get_base_storage(
        self, request: HttpRequest, path: str
    ) -> tuple[Path, Storage]:
        base = Path(path.removeprefix("/"))
        user = self.get_user_or_404(request)
        storage = get_user_storage(user, subdir=base)
        return base, storage

    def _not_a_directory(self, path):
        msg = _("path '{}' is not a directory").format(path)
        raise api_error("not-directory", msg)

    def _file_not_found(self, path):
        msg = _("file or diretory '{}' does not exist").format(path)
        raise api_error("not-found", msg)
