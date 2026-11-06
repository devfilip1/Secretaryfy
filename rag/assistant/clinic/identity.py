"""The clinic's name and kind from the Node server, which the panel edits in the database.

GET {CLINIC_URL} with the bearer token answers {"name", "kind", "language"}. The identity is read when each prompt is
built, through a short TTL cache. When the server cannot be reached or answers something invalid, the YAML values stay.
"""
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import httpx

from assistant.clinic.profile import ClinicProfile
from assistant.clinic.yaml_source import YamlClinicProfile

logger = logging.getLogger(__name__)

TIMEOUT_S = 5.0
IDENTITY_TTL_S = 5.0  # a rename applies within a few seconds, without a request per question
BRACES = ("{", "}")  # name and kind fill the prompt templates, where braces are placeholders

# (url, token) -> (status code, body text). The default makes the request with httpx; tests pass a fake.
Fetch = Callable[[str, str], tuple[int, str]]


@dataclass(frozen=True)
class ClinicIdentity:
    name: str
    kind: str
    language: str


class IdentitySource(Protocol):
    """Answers the identity, or None when the YAML values must be used."""

    def current(self) -> ClinicIdentity | None: ...


def _fetch_with_httpx(url: str, token: str) -> tuple[int, str]:
    response = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT_S)
    return response.status_code, response.text


def _parse(text: str) -> ClinicIdentity:
    payload = json.loads(text)
    values = [payload.get(field) for field in ("name", "kind", "language")] if isinstance(payload, dict) else []
    if len(values) != 3 or not all(isinstance(value, str) and value.strip() for value in values):
        raise ValueError("the answer must give name, kind and language as non-empty strings")
    name, kind, language = (value.strip() for value in values)
    if any(brace in name or brace in kind for brace in BRACES):
        raise ValueError("name and kind may not contain braces")
    return ClinicIdentity(name=name, kind=kind, language=language)


class HttpClinicIdentity:
    """Implements IdentitySource. A failure is logged once and answered as None, never raised to the caller."""

    def __init__(self, url: str, token: str, *, fetch: Fetch | None = None,
                 clock: Callable[[], float] = time.monotonic, ttl_s: float = IDENTITY_TTL_S):
        self.url = url
        self.token = token
        self._fetch = _fetch_with_httpx if fetch is None else fetch
        self._clock = clock
        self._ttl_s = ttl_s
        self._cached: tuple[ClinicIdentity | None, float] | None = None  # (identity or None on failure, when it was read)
        self._warned = False

    def current(self) -> ClinicIdentity | None:
        now = self._clock()
        if self._cached is not None and now - self._cached[1] < self._ttl_s:
            return self._cached[0]
        identity = self._read()
        self._cached = (identity, now)  # a failure is cached too: a down server does not delay every question
        return identity

    def _read(self) -> ClinicIdentity | None:
        try:
            status, text = self._fetch(self.url, self.token)
            if status != 200:
                raise ValueError(f"answered {status}, expected 200")
            return _parse(text)
        except Exception as error:
            self._warn(f"the clinic identity from {self.url} is not used, the YAML name and kind are: {error}")
            return None

    def _warn(self, message: str) -> None:
        if not self._warned:
            self._warned = True
            logger.warning(message)


class IdentityClinicProfile:
    """Implements ClinicProfileSource: the YAML profile with the name and kind the Node server holds."""

    def __init__(self, profile: YamlClinicProfile, identity: IdentitySource):
        self._profile = profile
        self._identity = identity
        self._warned_language = False

    def version(self) -> str:
        return self._profile.version()

    def load(self) -> ClinicProfile:
        identity = self._identity.current()
        if identity is None:
            return self._profile.load()
        profile = self._profile.load_as(identity.name, identity.kind)
        if identity.language != profile.language and not self._warned_language:
            self._warned_language = True
            logger.warning(
                "the clinic language is %s in the Node server and %s in the YAML profile: the profile keeps %s",
                identity.language, profile.language, profile.language,
            )
        return profile

