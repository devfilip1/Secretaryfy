"""Knowledge served by the Node server: GET {KNOWLEDGE_URL} with the bearer token answers the sections as JSON.

The JSON is {"name": str, "version": str, "sections": [{"title": str, "body": [str]}]}. The document is built the same way
the Markdown source builds it, so chunking does not know the knowledge came over HTTP.
"""
import json
import time
from collections.abc import Callable

import httpx

from assistant.ingestion.markdown_source import document_from_sections
from assistant.ingestion.source import KnowledgeDocument, Section

TIMEOUT_S = 10.0  # the knowledge is read when the index is built or checked, never while answering a question
VERSION_TTL_S = 5.0  # /health asks for the version on every call; the version is kept this long, the document is not

# (url, token) -> (status code, body text). The default makes the request with httpx; tests pass a fake.
Fetch = Callable[[str, str], tuple[int, str]]


class KnowledgeUnavailable(Exception):
    """The Node server did not give the knowledge. The message names the URL and says why, never the token."""


def _fetch_with_httpx(url: str, token: str) -> tuple[int, str]:
    response = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT_S)
    return response.status_code, response.text


def _is_section(item) -> bool:
    return (
        isinstance(item, dict)
        and isinstance(item.get("title"), str)
        and isinstance(item.get("body"), list)
        and all(isinstance(line, str) for line in item["body"])
    )


def _matches_contract(payload) -> bool:
    return (
        isinstance(payload, dict)
        and isinstance(payload.get("name"), str)
        and isinstance(payload.get("version"), str)
        and isinstance(payload.get("sections"), list)
        and all(_is_section(item) for item in payload["sections"])
    )


class HttpKnowledgeSource:
    def __init__(self, url: str, token: str, *, fetch: Fetch | None = None,
                 clock: Callable[[], float] = time.monotonic, ttl_s: float = VERSION_TTL_S):
        self.url = url
        self.token = token
        self._fetch = _fetch_with_httpx if fetch is None else fetch
        self._clock = clock
        self._ttl_s = ttl_s
        self._cached_version: tuple[str, float] | None = None  # (version, when it was read)

    def version(self) -> str:
        now = self._clock()
        if self._cached_version is not None and now - self._cached_version[1] < self._ttl_s:
            return self._cached_version[0]
        version = self.load().version
        self._cached_version = (version, now)
        return version

    def load(self) -> KnowledgeDocument:
        status, text = self._get()
        if status != 200:
            raise KnowledgeUnavailable(f"the knowledge server at {self.url} answered {status}, expected 200")
        return self._document(text)

    def _get(self) -> tuple[int, str]:
        try:
            return self._fetch(self.url, self.token)
        except Exception as error:
            raise KnowledgeUnavailable(f"could not reach the knowledge server at {self.url}: {error}") from error

    def _document(self, text: str) -> KnowledgeDocument:
        try:
            payload = json.loads(text)
        except ValueError as error:
            raise KnowledgeUnavailable(f"the knowledge from {self.url} is not valid JSON: {error}") from error
        if not _matches_contract(payload):
            raise KnowledgeUnavailable(
                f"the knowledge from {self.url} does not match the contract: "
                "name, version and sections (each with title and body) are required"
            )
        sections = tuple(Section(item["title"], tuple(item["body"])) for item in payload["sections"])
        return document_from_sections(payload["name"], payload["version"], sections)
