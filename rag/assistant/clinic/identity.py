"""The clinic's name and kind from the Node server, which the panel edits in the database.

GET {CLINIC_URL} with the bearer token answers {"name", "kind", "language"}. The identity is read when each prompt is
built, through a short TTL cache. When the server cannot be reached or answers something invalid, the YAML values stay.
"""
import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Protocol

import httpx

from assistant.clinic.profile import ClinicProfile
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.retrieval.lexical import _plain

logger = logging.getLogger(__name__)

TIMEOUT_S = 5.0
IDENTITY_TTL_S = 5.0  # a rename applies within a few seconds, without a request per question
BRACES = ("{", "}")  # name and kind fill the prompt templates, where braces are placeholders

# (url, token) -> (status code, body text). The default makes the request with httpx; tests pass a fake.
Fetch = Callable[[str, str], tuple[int, str]]


@dataclass(frozen=True)
class Treatment:
    """A treatment as the Node server lists it: its title, the other names patients use, the labels of extra values."""

    title: str
    other_names: tuple[str, ...] = ()
    extra_labels: tuple[str, ...] = ()  # values besides price and duration ("Mensalidade", "Siso")


@dataclass(frozen=True)
class ClinicIdentity:
    name: str
    kind: str
    language: str
    treatments: tuple[Treatment, ...] = ()


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
    return ClinicIdentity(name=name, kind=kind, language=language, treatments=_parse_treatments(payload.get("treatments")))


def _parse_treatments(value) -> tuple[Treatment, ...]:
    if value is None:
        return ()

    def strings(item, field):
        names = item.get(field, [])
        return isinstance(names, list) and all(isinstance(n, str) for n in names)

    ok = isinstance(value, list) and all(
        isinstance(item, dict) and isinstance(item.get("title"), str) and strings(item, "otherNames") and strings(item, "extraLabels")
        for item in value
    )
    if not ok:
        raise ValueError("treatments must be a list of {title, otherNames, extraLabels}")
    return tuple(
        Treatment(item["title"], tuple(item.get("otherNames", ())), tuple(item.get("extraLabels", ()))) for item in value
    )


def _words(text: str) -> list[str]:
    return [word for word in re.findall(r"[a-z0-9]+", _plain(text)) if len(word) >= 3]


def treatment_synonyms(treatments) -> dict[str, tuple[str, ...]]:
    """Each word of an other name -> the words of the treatment title, as the brochure writes them."""
    merged: dict[str, list[str]] = {}
    for treatment in treatments:
        target = _words(treatment.title)
        for name in treatment.other_names:
            for word in _words(name):
                merged.setdefault(word, []).extend(item for item in target if item not in merged.get(word, []))
    return {word: tuple(items) for word, items in merged.items()}


def _plain_text(text: str) -> str | None:
    """The text for a prompt: braces are placeholders there, so a text with braces is not used."""
    text = " ".join(text.split())
    return text if text and not any(brace in text for brace in BRACES) else None


def example_treatment(treatments) -> str | None:
    """Rule 3 of the prompt calls a treatment by its plain name: the first treatment of the brochure."""
    return next((name.lower() for name in (_plain_text(t.title) for t in treatments) if name), None)


def extra_rules(treatments) -> str | None:
    """Rule 5: treatments with more than one price or duration, each value with its own name."""
    parts = []
    for treatment in treatments:
        title = _plain_text(treatment.title)
        labels = [label for label in map(_plain_text, treatment.extra_labels) if label]
        if title and labels:
            parts.append(f"{title}: " + ", ".join(f'"{label}"' for label in labels) + ".")
    if not parts:
        return None
    return (
        "5. Some treatments have more than one price or duration, each with its own name: "
        + " ".join(parts)
        + " Give the one the customer asked about; if the question is general, give all of them, each with its name."
    )


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
        identity = self._identity.current()
        names = treatment_synonyms(identity.treatments) if identity else {}
        return f"{self._profile.version()};names:{sorted(names.items())}"  # a changed name list rebuilds the word index

    def load(self) -> ClinicProfile:
        identity = self._identity.current()
        if identity is None:
            return self._profile.load()
        profile = self._profile.load_as(
            identity.name, identity.kind, example_treatment(identity.treatments), extra_rules(identity.treatments)
        )
        if identity.language != profile.language and not self._warned_language:
            self._warned_language = True
            logger.warning(
                "the clinic language is %s in the Node server and %s in the YAML profile: the profile keeps %s",
                identity.language, profile.language, profile.language,
            )
        names = treatment_synonyms(identity.treatments)
        if not names:
            return profile
        merged = {**profile.lexicon.synonyms}
        for word, items in names.items():
            merged[word] = tuple(dict.fromkeys([*merged.get(word, ()), *items]))
        return replace(profile, lexicon=replace(profile.lexicon, synonyms=merged))

