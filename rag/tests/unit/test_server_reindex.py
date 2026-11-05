"""POST /reindex and the knowledge part of /health. The indexes go to tmp_path and no model is called."""
import threading

import pytest
from fastapi.testclient import TestClient

import server
from assistant import index
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.index import CURRENT
from assistant.ingestion.http_source import HttpKnowledgeSource, KnowledgeUnavailable
from assistant.ingestion.source import KnowledgeDocument, Section
from assistant.retrieval.pipeline import RagConfig, RagDeps
from assistant.settings import load_settings

TOKEN = "internal-test-token"
CONFIG = RagConfig.from_experiment("section_hybrid")
CLINIC_SOURCE = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR)
SECTIONS = (Section("Braces", ("Price: $180–$450",)), Section("Cleaning", ("Price: $40–$85",)))


class FakeKnowledge:
    """Knowledge with a version; can fail, and can block inside load() until the test releases it."""

    def __init__(self, version="v2", error=None, version_error=None, hold=None):
        self.version_value = version
        self.error = error
        self.version_error = version_error
        self.hold = hold
        self.started = threading.Event()
        self.loads = 0

    def version(self):
        if self.version_error is not None:
            raise self.version_error
        return self.version_value

    def load(self):
        self.loads += 1
        self.started.set()
        if self.hold is not None:
            self.hold.wait(5)
        if self.error is not None:
            raise self.error
        return KnowledgeDocument("fake.md", self.version_value, ("Braces\nPrice: $180–$450",), SECTIONS)


class RecordingStore:
    def __init__(self, strategy, rebuilds):
        self.strategy, self.rebuilds = strategy, rebuilds

    def rebuild(self, documents):
        self.rebuilds.append((self.strategy, len(documents)))


class FakeProvider:
    def __init__(self):
        self.rebuilds = []
        self.requested = []

    def __call__(self, strategy):
        self.requested.append(strategy)
        return RecordingStore(strategy, self.rebuilds)


@pytest.fixture
def indexes(monkeypatch, tmp_path):
    monkeypatch.setattr(index, "INDEX_DIR", tmp_path)
    return tmp_path


def make_app(knowledge, provider=None, token=TOKEN):
    deps = RagDeps(
        vector_store_provider=provider or FakeProvider(), embeddings=object(), generator=object(),
        lexical=object(), clinic=CLINIC_SOURCE,
    )
    return server.create_app(CONFIG, deps=deps, knowledge_source=knowledge, internal_token=token)


def bearer(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def test_reindex_rebuilds_every_declared_strategy_and_reports_the_counts(indexes):
    provider = FakeProvider()
    declared = set(load_settings().strategies)

    response = TestClient(make_app(FakeKnowledge(), provider)).post("/reindex", headers=bearer())

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "v2"
    assert set(body["chunks"]) == declared
    assert all(count >= 1 for count in body["chunks"].values())
    assert {name for name, _ in provider.rebuilds} == declared


def test_reindex_writes_the_manifest_with_the_knowledge_version(indexes):
    TestClient(make_app(FakeKnowledge(version="v7"))).post("/reindex", headers=bearer())

    assert index.read_manifest("section", indexes)["source_hash"] == "v7"


def test_reindex_refuses_a_request_without_the_bearer_token(indexes):
    knowledge = FakeKnowledge()
    client = TestClient(make_app(knowledge))

    assert client.post("/reindex").status_code == 401
    assert client.post("/reindex", headers=bearer("wrong")).status_code == 401
    assert client.post("/reindex", headers={"Authorization": TOKEN}).status_code == 401
    assert knowledge.loads == 0


def test_reindex_does_not_exist_without_an_internal_token(indexes):
    response = TestClient(make_app(FakeKnowledge(), token="")).post("/reindex", headers=bearer(""))

    assert response.status_code == 404


def test_a_second_reindex_while_one_runs_gets_409(indexes):
    release = threading.Event()
    knowledge = FakeKnowledge(hold=release)
    app = make_app(knowledge)
    first = {}

    def run_first():
        first["response"] = TestClient(app).post("/reindex", headers=bearer())

    worker = threading.Thread(target=run_first)
    worker.start()
    try:
        assert knowledge.started.wait(5)
        second = TestClient(app).post("/reindex", headers=bearer())
    finally:
        release.set()
        worker.join(5)

    assert second.status_code == 409
    assert first["response"].status_code == 200


def test_an_unreachable_knowledge_server_is_503_with_its_message(indexes):
    message = "could not reach the knowledge server at http://127.0.0.1:3000/internal/knowledge: refused"

    response = TestClient(make_app(FakeKnowledge(error=KnowledgeUnavailable(message)))).post("/reindex", headers=bearer())

    assert response.status_code == 503
    assert response.json() == {"detail": message}


def test_the_lock_is_released_after_a_failed_reindex(indexes):
    knowledge = FakeKnowledge(error=KnowledgeUnavailable("down"))
    client = TestClient(make_app(knowledge))

    assert client.post("/reindex", headers=bearer()).status_code == 503
    knowledge.error = None
    assert client.post("/reindex", headers=bearer()).status_code == 200


def test_health_reports_the_file_knowledge_and_its_version(monkeypatch, indexes):
    monkeypatch.setattr(server, "ollama_reachable", lambda: True)
    monkeypatch.setattr(server, "index_state", lambda strategy: (CURRENT, None))

    body = TestClient(make_app(FakeKnowledge(version="v2"))).get("/health").json()

    assert body["knowledge"] == {"source": "file", "version": "v2"}
    assert body["status"] == "ready"


def test_health_reports_the_http_knowledge_source(monkeypatch, indexes):
    monkeypatch.setattr(server, "ollama_reachable", lambda: True)
    monkeypatch.setattr(server, "index_state", lambda strategy: (CURRENT, None))
    source = HttpKnowledgeSource(
        "http://127.0.0.1:3000/internal/knowledge", TOKEN,
        fetch=lambda url, token: (200, '{"name": "c", "version": "h9", "sections": []}'),
    )

    body = TestClient(make_app(source)).get("/health").json()

    assert body["knowledge"] == {"source": "http", "version": "h9"}


