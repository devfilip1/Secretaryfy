"""The HTTP service, with the pipeline and Ollama replaced: no model is needed."""
import sys

import pytest
from fastapi.testclient import TestClient

import server
from assistant.index import CURRENT, STALE, IndexUnavailable
from assistant.pipeline import AnswerResult, RagConfig, RetrievalResult, RetrievedChunk
from assistant.retrieval.service import RagService
from assistant.settings import SettingsError

BRACES = "Braces and Orthodontic Treatment\nPrice: $180–$450 (Initial cost) and $35–$90 (Monthly)"
CHUNK = RetrievedChunk(BRACES, rank=1, score=0.0328, similarity=0.71)
RETRIEVAL = RetrievalResult(vector=[CHUNK], bm25=[CHUNK], fused=[CHUNK])
ANSWER = "Braces cost $180–$450 (Initial cost) and $35–$90 (Monthly). Would you like to schedule an assessment?"


HISTORIES = []  # the conversation each answer received


def test_rag_service_requires_an_effective_vector_store_provider():
    with pytest.raises(ValueError, match="vector_store_provider is required"):
        RagService(RagConfig.from_experiment("section_hybrid"), None, object())


@pytest.fixture
def calls(monkeypatch):
    """Replaces the pipeline and records the questions it received."""
    from assistant import pipeline

    asked = []
    HISTORIES.clear()

    def fake_answer(question, config, history=None, *, vector_store_provider, embeddings):
        asked.append(question)
        HISTORIES.append(history)
        return AnswerResult(answer=ANSWER, retrieval=RETRIEVAL, latency_s=0.74)

    def fake_retrieve(question, config, *, vector_store_provider, embeddings):
        asked.append(question)
        return RETRIEVAL

    monkeypatch.setattr(pipeline, "answer_with_store", fake_answer)
    monkeypatch.setattr(pipeline, "retrieve_with_store", fake_retrieve)
    return asked


@pytest.fixture
def client():
    return TestClient(server.create_app(
        RagConfig.from_experiment("section_hybrid"),
        vector_store_provider=lambda strategy: pytest.fail("the fakes replace the pipeline, the store is not used"),
        embeddings=object(),  # the fakes replace the pipeline, so the model is not called
    ))


def test_answer_returns_the_reply_and_the_chunks_it_used(client, calls):
    response = client.post("/answer", json={"question": "How much are braces?"})

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == ANSWER
    assert body["chunks"] == [{"rank": 1, "content": BRACES, "score": 0.0328, "similarity": 0.71}]
    assert body["latency_s"] == 0.74
    assert body["experiment"] == "section_hybrid"
    assert calls == ["How much are braces?"]
    assert HISTORIES == [[]]


def test_app_uses_injected_vector_store_for_answer_and_retrieve(monkeypatch):
    from types import SimpleNamespace

    from assistant import pipeline

    config = RagConfig(
        experiment="fake", strategy="fake", search_type="vector", match_count=1,
        match_threshold=0.0, use_hyde=False, prompt="rules",
    )
    document = SimpleNamespace(page_content=BRACES)
    calls = []

    class FakeStore:
        def search_by_vector(self, vector, limit):
            calls.append(("search", vector, limit))
            return [document]

        def vectors_by_content(self):
            return {BRACES: [1.0, 0.0]}

    class FakeEmbeddings:
        def embed_query(self, question):
            return [1.0, 0.0]

    class FakeModel:
        def invoke(self, prompt):
            return SimpleNamespace(content="Braces cost $180–$450.")

    def provider(strategy):
        calls.append(("provider", strategy))
        return FakeStore()

    embeddings = FakeEmbeddings()
    monkeypatch.setattr(pipeline, "_model", lambda *args: FakeModel())
    monkeypatch.setitem(sys.modules, "assistant.storage.chroma", None)
    app = server.create_app(config, vector_store_provider=provider, embeddings=embeddings)

    with TestClient(app) as client:
        retrieved = client.post("/retrieve", json={"question": "How much are braces?"})
        answered = client.post("/answer", json={"question": "How much are braces?"})

    assert retrieved.status_code == 200
    assert retrieved.json()["chunks"][0]["content"] == BRACES
    assert answered.status_code == 200
    assert answered.json()["answer"] == "Braces cost $180–$450."
    assert [call for call in calls if call[0] == "provider"] == [("provider", "fake"), ("provider", "fake")]


def test_answer_passes_the_conversation_along(client, calls):
    history = [
        {"role": "user", "content": "Do you offer a cleaning?"},
        {"role": "assistant", "content": "Yes, we do!"},
    ]
    response = client.post("/answer", json={"question": "how much does it cost?", "history": history})

    assert response.status_code == 200
    assert HISTORIES == [history]


def test_answer_rejects_an_unknown_role(client, calls):
    response = client.post("/answer", json={"question": "hi", "history": [{"role": "system", "content": "x"}]})

    assert response.status_code == 422
    assert calls == []


def test_retrieve_returns_only_the_chunks(client, calls):
    response = client.post("/retrieve", json={"question": "How much are braces?"})

    assert response.status_code == 200
    body = response.json()
    assert "answer" not in body
    assert body["chunks"][0]["content"] == BRACES
    assert body["experiment"] == "section_hybrid"
    assert body["latency_s"] >= 0


@pytest.mark.parametrize("path", ["/answer", "/retrieve"])
@pytest.mark.parametrize("payload", [{"question": "   "}, {"question": ""}, {}])
def test_an_empty_question_is_rejected_without_calling_the_model(client, calls, path, payload):
    response = client.post(path, json=payload)

    assert response.status_code == 422
    assert calls == []


@pytest.mark.parametrize("path, name", [("/answer", "answer"), ("/retrieve", "retrieve")])
def test_a_model_failure_becomes_503(client, monkeypatch, path, name):
    from assistant import pipeline

    def fail(question, config, history=None, **kwargs):
        raise ConnectionError("Ollama is not running")

    monkeypatch.setattr(pipeline, f"{name}_with_store", fail)

    response = client.post(path, json={"question": "How much are braces?"})

    assert response.status_code == 503
    assert response.json() == {"detail": "Ollama is not running"}


@pytest.fixture
def health(monkeypatch, client):
    """Calls /health with the given state of Ollama and of the index."""

    def call(reachable=True, state=CURRENT, reason=None):
        monkeypatch.setattr(server, "ollama_reachable", lambda: reachable)
        monkeypatch.setattr(server, "index_state", lambda strategy: (state, reason))
        return client.get("/health")

    return call


def test_health_is_ready_with_ollama_and_a_current_index(health):
    response = health()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["experiment"] == "section_hybrid"
    assert body["ollama"]["reachable"] is True
    assert body["index"] == {"strategy": "section", "state": "current", "reason": None}


def test_health_is_unavailable_without_ollama(health):
    response = health(reachable=False)

    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
    assert response.json()["ollama"]["reachable"] is False


def test_health_is_unavailable_with_a_stale_index(health):
    reason = 'the index of strategy "section" is out of date; run: python -m assistant.ingest section'

    response = health(state=STALE, reason=reason)

    assert response.status_code == 503
    assert response.json()["index"]["reason"] == reason


def test_ollama_reachable_is_false_when_nothing_listens():
    assert server.ollama_reachable("http://127.0.0.1:9", timeout=0.5) is False


def test_main_refuses_to_start_with_an_unusable_index(monkeypatch, capsys):
    reason = 'the index of strategy "section" has not been built yet; run: python -m assistant.ingest section'

    def unavailable(strategy):
        raise IndexUnavailable(reason)

    monkeypatch.setattr(server, "require_index", unavailable)
    monkeypatch.setattr(server.uvicorn, "run", lambda *args, **kwargs: pytest.fail("must not start"))

    with pytest.raises(SystemExit) as exit_info:
        server.main()

    assert exit_info.value.code == 1
    assert capsys.readouterr().out.strip() == f"Could not start: {reason}"


def test_main_refuses_to_start_with_an_invalid_configuration(monkeypatch, capsys):
    def invalid():
        raise SettingsError(["experiments.yaml: unknown strategy \"nope\""])

    monkeypatch.setattr(server, "RagConfig", invalid)
    monkeypatch.setattr(server.uvicorn, "run", lambda *args, **kwargs: pytest.fail("must not start"))

    with pytest.raises(SystemExit) as exit_info:
        server.main()

    assert exit_info.value.code == 2
    assert "Invalid configuration: 1 problem(s)" in capsys.readouterr().out


def test_main_starts_on_the_configured_address(monkeypatch):
    started = {}
    monkeypatch.setattr(server, "require_index", lambda strategy: None)
    monkeypatch.setattr(server.uvicorn, "run", lambda app, host, port: started.update(host=host, port=port))
    monkeypatch.setenv("RAG_PORT", "8123")
    monkeypatch.delenv("RAG_HOST", raising=False)

    server.main()

    assert started == {"host": "127.0.0.1", "port": 8123}


def test_main_listens_on_the_host_set_in_the_environment(monkeypatch):
    started = {}
    monkeypatch.setattr(server, "require_index", lambda strategy: None)
    monkeypatch.setattr(server.uvicorn, "run", lambda app, host, port: started.update(host=host, port=port))
    monkeypatch.setenv("RAG_HOST", "0.0.0.0")
    monkeypatch.setenv("RAG_PORT", "9000")

    server.main()

    assert started == {"host": "0.0.0.0", "port": 9000}


def test_create_app_needs_a_service_or_a_provider():
    with pytest.raises(ValueError, match="create_app needs a service or a vector_store_provider"):
        server.create_app(RagConfig.from_experiment("section_hybrid"))


def test_main_serves_the_service_built_by_the_composition_root(monkeypatch):
    built, served = [], []
    sentinel = object()
    monkeypatch.setattr(server, "require_index", lambda strategy: None)
    monkeypatch.setattr(server, "build_rag_service", lambda config: built.append(config) or sentinel)
    monkeypatch.setattr(server, "create_app", lambda config, *, service: served.append(service) or "app")
    monkeypatch.setattr(server.uvicorn, "run", lambda app, host, port: None)

    server.main()

    assert len(built) == 1
    assert served == [sentinel]


def test_create_app_needs_embeddings_with_a_provider():
    with pytest.raises(ValueError, match="embeddings is required"):
        server.create_app(RagConfig.from_experiment("section_hybrid"), vector_store_provider=lambda strategy: None)


@pytest.mark.parametrize("path", ["/answer", "/retrieve"])
def test_an_embedding_mismatch_becomes_503_with_the_rebuild_command(path):
    from assistant.index import EmbeddingMismatch

    message = 'the embedding model returned 768 dimensions but the index of strategy "section" has 1024; run: python -m assistant.ingest section'

    class MismatchedService:
        def answer(self, question, history):
            raise EmbeddingMismatch(message)

        def retrieve(self, question):
            raise EmbeddingMismatch(message)

    app = server.create_app(RagConfig.from_experiment("section_hybrid"), service=MismatchedService())
    response = TestClient(app).post(path, json={"question": "How much are braces?"})

    assert response.status_code == 503
    assert response.json() == {"detail": message}
