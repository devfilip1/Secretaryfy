"""The version of the knowledge server is kept for a few seconds, so /health does not fetch the whole document twice."""
import json

import pytest

from assistant.ingestion.http_source import VERSION_TTL_S, HttpKnowledgeSource, KnowledgeUnavailable

URL = "http://127.0.0.1:3000/internal/knowledge"
TOKEN = "internal-test-token"
BODY = json.dumps({"name": "clinic", "version": "h9", "sections": [{"title": "Cleaning", "body": ["Price: 40"]}]})


class CountingFetch:
    def __init__(self, error=None):
        self.calls = 0
        self.error = error

    def __call__(self, url, token):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return 200, BODY


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_the_version_is_fetched_once_within_the_ttl():
    fetch, clock = CountingFetch(), Clock()
    source = HttpKnowledgeSource(URL, TOKEN, fetch=fetch, clock=clock)

    assert source.version() == "h9"
    clock.now += VERSION_TTL_S - 0.5
    assert source.version() == "h9"

    assert fetch.calls == 1


def test_the_version_is_fetched_again_after_the_ttl():
    fetch, clock = CountingFetch(), Clock()
    source = HttpKnowledgeSource(URL, TOKEN, fetch=fetch, clock=clock)

    source.version()
    clock.now += VERSION_TTL_S
    source.version()

    assert fetch.calls == 2


def test_a_failed_fetch_is_not_cached():
    fetch, clock = CountingFetch(error=ConnectionError("refused")), Clock()
    source = HttpKnowledgeSource(URL, TOKEN, fetch=fetch, clock=clock)

    with pytest.raises(KnowledgeUnavailable):
        source.version()
    fetch.error = None

    assert source.version() == "h9"
    assert fetch.calls == 2


def test_load_always_fetches_the_document_even_after_a_cached_version():
    fetch, clock = CountingFetch(), Clock()
    source = HttpKnowledgeSource(URL, TOKEN, fetch=fetch, clock=clock)

    source.version()
    source.load()

    assert fetch.calls == 2
