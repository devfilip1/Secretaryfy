"""The knowledge the Node server serves, read through the KnowledgeSource contract. No server is started."""
import json
from pathlib import Path
import re

import pytest

from assistant import config
from assistant.ingest import build_chunks
from assistant.ingestion.http_source import HttpKnowledgeSource, KnowledgeUnavailable
from assistant.ingestion.markdown_source import MarkdownKnowledgeSource, parse_sections
from assistant.ingestion.source import KnowledgeDocument, Section
from assistant.settings import Strategy
from assistant.storage import factory

ROOT = Path(__file__).parents[2]
SORRISO = ROOT / "data" / "source" / "sorrisopleno.md"
URL = "http://127.0.0.1:3000/internal/knowledge"
TOKEN = "internal-test-token"
SECTION = Strategy("section", "section", {"max_chars": 1200, "overlap": 100})


class FakeFetch:
    """Stands in for the request: answers the given status and body, or raises the given error."""

    def __init__(self, status=200, body="", error=None):
        self.status, self.body, self.error = status, body, error
        self.calls = []

    def __call__(self, url, token):
        self.calls.append((url, token))
        if self.error is not None:
            raise self.error
        return self.status, self.body


def contract_json(markdown_path, version):
    """The JSON the Node server gives for the content of a Markdown file."""
    sections = parse_sections(markdown_path.read_text(encoding="utf-8"))
    return json.dumps({
        "name": markdown_path.name,
        "version": version,
        "sections": [{"title": section.title, "body": list(section.body)} for section in sections],
    })


def test_the_document_built_from_the_json_equals_the_markdown_document():
    markdown = MarkdownKnowledgeSource(SORRISO, name=SORRISO.name)
    body = contract_json(SORRISO, markdown.version())
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(body=body))

    assert source.load() == markdown.load()


def test_the_chunks_are_identical_to_the_markdown_source():
    markdown = MarkdownKnowledgeSource(SORRISO, name=SORRISO.name)
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(body=contract_json(SORRISO, markdown.version())))

    from_http = [(chunk.page_content, chunk.metadata) for chunk in build_chunks(SECTION, source.load())]
    from_markdown = [(chunk.page_content, chunk.metadata) for chunk in build_chunks(SECTION, markdown.load())]

    assert from_http
    assert from_http == from_markdown


def test_the_version_is_the_one_the_server_reports():
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(body=json.dumps(
        {"name": "clinic", "version": "abc123", "sections": [{"title": "Cleaning", "body": ["Price: 40"]}]}
    )))

    assert source.version() == "abc123"
    assert source.version() == source.load().version


def test_the_request_goes_to_the_url_with_the_bearer_token():
    fetch = FakeFetch(body=json.dumps({"name": "clinic", "version": "v", "sections": []}))

    HttpKnowledgeSource(URL, TOKEN, fetch=fetch).load()

    assert fetch.calls == [(URL, TOKEN)]


def test_a_server_that_is_down_is_named_by_its_url():
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(error=ConnectionError("connection refused")))

    with pytest.raises(KnowledgeUnavailable, match=re.escape(URL)) as error:
        source.load()

    assert "connection refused" in str(error.value)
    assert TOKEN not in str(error.value)


@pytest.mark.parametrize("status", [401, 404, 500, 503])
def test_a_status_other_than_200_is_named_with_the_url_and_the_status(status):
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(status=status, body="{}"))

    with pytest.raises(KnowledgeUnavailable, match=rf"{re.escape(URL)}.*{status}"):
        source.version()


def test_invalid_json_is_named_with_the_url():
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(body="<html>not json</html>"))

    with pytest.raises(KnowledgeUnavailable, match=rf"not valid JSON.*{re.escape(URL)}|{re.escape(URL)}.*not valid JSON"):
        source.load()


@pytest.mark.parametrize("body", [
    json.dumps({"name": "clinic"}),
    json.dumps({"name": "clinic", "version": "v", "sections": [{"title": "Cleaning"}]}),
    json.dumps({"name": "clinic", "version": "v", "sections": [{"title": "Cleaning", "body": "Price: 40"}]}),
    json.dumps(["not", "an", "object"]),
])
def test_a_body_that_breaks_the_contract_is_refused(body):
    source = HttpKnowledgeSource(URL, TOKEN, fetch=FakeFetch(body=body))

    with pytest.raises(KnowledgeUnavailable, match="does not match the contract"):
        source.load()


def test_the_factory_reads_the_server_when_knowledge_url_is_set(monkeypatch):
    monkeypatch.setattr(config, "KNOWLEDGE_URL", URL)
    monkeypatch.setattr(config, "INTERNAL_TOKEN", TOKEN)
    factory.reset_default_knowledge_source()
    try:
        source = factory.default_knowledge_source()
    finally:
        factory.reset_default_knowledge_source()

    assert isinstance(source, HttpKnowledgeSource)
    assert (source.url, source.token) == (URL, TOKEN)


def test_the_factory_reads_the_file_when_knowledge_url_is_empty(monkeypatch):
    monkeypatch.setattr(config, "KNOWLEDGE_URL", "")
    factory.reset_default_knowledge_source()
    try:
        source = factory.default_knowledge_source()
    finally:
        factory.reset_default_knowledge_source()

    assert not isinstance(source, HttpKnowledgeSource)
    assert source.version()
