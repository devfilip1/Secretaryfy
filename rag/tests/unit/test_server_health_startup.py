"""/health and the startup of the server when the knowledge comes from the Node server. No model and no network are used."""
import pytest
from fastapi.testclient import TestClient

import server
from assistant import index
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.index import CURRENT, MISSING
from assistant.ingestion.http_source import HttpKnowledgeSource
from assistant.retrieval.pipeline import RagConfig, RagDeps
from assistant.settings import get_strategy

TOKEN = "internal-test-token"
URL = "http://127.0.0.1:3000/internal/knowledge"
CONFIG = RagConfig.from_experiment("section_hybrid")
CLINIC_SOURCE = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR)
SECTION = get_strategy("section")
PAYLOAD = '{"name": "c", "version": "h9", "sections": []}'


class FileKnowledge:
    def version(self):
        return "v2"


def refuse(url, token):
    raise ConnectionError("refused")


@pytest.fixture
def indexes(monkeypatch, tmp_path):
    monkeypatch.setattr(index, "INDEX_DIR", tmp_path)
    monkeypatch.setattr(server, "ollama_reachable", lambda: True)
    return tmp_path


def write_index(base, source):
    index.write_manifest(SECTION, 3, base=base, source=source)
    index.chunks_path(SECTION.name, base).write_text("[]", encoding="utf-8")


def client_for(source):
    deps = RagDeps(vector_store_provider=lambda strategy: None, embeddings=object(), generator=object(),
                   lexical=object(), clinic=CLINIC_SOURCE)
    return TestClient(server.create_app(CONFIG, deps=deps, knowledge_source=source, internal_token=TOKEN))


def test_health_stays_ready_when_the_knowledge_server_is_down_and_an_index_exists(indexes):
    write_index(indexes, source="h9")

    response = client_for(HttpKnowledgeSource(URL, TOKEN, fetch=refuse)).get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["index"]["state"] == CURRENT
    assert body["index"]["built_from"] == "h9"
    assert body["knowledge"] == {"source": "http", "version": None, "reachable": False}


def test_health_is_unavailable_when_the_knowledge_server_is_down_and_no_index_exists(indexes):
    response = client_for(HttpKnowledgeSource(URL, TOKEN, fetch=refuse)).get("/health")

    assert response.status_code == 503
    body = response.json()
    assert body["index"]["state"] == MISSING
    assert body["index"]["built_from"] is None
    assert body["knowledge"] == {"source": "http", "version": None, "reachable": False}


def test_health_reports_the_reachable_http_version_and_the_built_from_version(indexes):
    write_index(indexes, source="h9")

    body = client_for(HttpKnowledgeSource(URL, TOKEN, fetch=lambda url, token: (200, PAYLOAD))).get("/health").json()

    assert body["knowledge"] == {"source": "http", "version": "h9"}
    assert body["index"]["built_from"] == "h9"


def test_health_reports_built_from_for_the_file_source_too(indexes):
    write_index(indexes, source="v1")

    body = client_for(FileKnowledge()).get("/health").json()

    assert body["knowledge"] == {"source": "file", "version": "v2"}
    assert body["index"]["built_from"] == "v1"


def test_health_fetches_the_knowledge_version_once_for_two_calls(indexes):
    calls = []

    def fetch(url, token):
        calls.append(url)
        return 200, PAYLOAD

    client = client_for(HttpKnowledgeSource(URL, TOKEN, fetch=fetch))
    client.get("/health")
    client.get("/health")

    assert len(calls) == 1


def start_main(monkeypatch, fetch):
    started = []
    monkeypatch.setattr(server, "build_knowledge_source", lambda: HttpKnowledgeSource(URL, TOKEN, fetch=fetch))
    monkeypatch.setattr(server, "build_embeddings_provider", lambda: object())
    monkeypatch.setattr(server, "check_embedding_dimensions", lambda strategy, embeddings: None)
    monkeypatch.setattr(server, "build_rag_service", lambda config: object())
    monkeypatch.setattr(server.uvicorn, "run", lambda app, host, port: started.append(port))
    server.main()
    return started


def test_main_starts_with_unpublished_knowledge_and_prints_one_warning(indexes, monkeypatch, capsys):
    write_index(indexes, source="h1")

    started = start_main(monkeypatch, lambda url, token: (200, PAYLOAD))

    lines = capsys.readouterr().out.strip().splitlines()
    assert started
    assert len(lines) == 1
    assert "unpublished changes" in lines[0]


def test_main_starts_when_the_knowledge_server_is_down_and_prints_one_warning(indexes, monkeypatch, capsys):
    write_index(indexes, source="h1")

    started = start_main(monkeypatch, refuse)

    lines = capsys.readouterr().out.strip().splitlines()
    assert started
    assert len(lines) == 1
    assert "could not reach the knowledge server" in lines[0]


def test_main_refuses_to_start_with_http_knowledge_and_no_index(indexes, monkeypatch, capsys):
    monkeypatch.setattr(server.uvicorn, "run", lambda *args, **kwargs: pytest.fail("must not start"))

    with pytest.raises(SystemExit) as exit_info:
        start_main(monkeypatch, lambda url, token: (200, PAYLOAD))

    assert exit_info.value.code == 1
    assert "has not been built yet" in capsys.readouterr().out
