import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from assistant.storage import chroma as chroma_store
from assistant.storage import vector_store

stub_model = object()  # stands in for the embedding model; the fakes below never call it


class FakeChroma:
    def __init__(self):
        self.search_calls = []
        self.deleted = 0
        self._collection = SimpleNamespace(get=lambda **kwargs: {
            "documents": ["alpha", "beta"],
            "embeddings": [[1.0, 0.0], [0.0, 1.0]],
        })

    def similarity_search_by_vector(self, vector, k):
        self.search_calls.append((vector, k))
        return [SimpleNamespace(page_content="alpha")]

    def similarity_search(self, query, k):
        self.search_calls.append((query, k))
        return [SimpleNamespace(page_content="beta")]

    def delete_collection(self):
        self.deleted += 1


def recording_opener(opened):
    """Opener for the provider that records each strategy it opens and returns a fresh fake store."""
    def open_store(strategy, embeddings):
        opened.append(strategy)
        return FakeChroma()

    return open_store


def test_chroma_adapter_maps_search_and_embedding_operations():
    backend = FakeChroma()
    adapter = chroma_store.ChromaVectorStore(backend, "section", stub_model)

    assert adapter.search_by_vector([1.0, 0.0], limit=3)[0].page_content == "alpha"
    assert adapter.search_by_text("question", limit=2)[0].page_content == "beta"
    assert adapter.vectors_by_content() == {"alpha": [1.0, 0.0], "beta": [0.0, 1.0]}
    assert backend.search_calls == [([1.0, 0.0], 3), ("question", 2)]


def test_provider_returns_the_same_adapter_for_the_same_strategy():
    opened = []
    provider = chroma_store.ChromaVectorStoreProvider(open_store=recording_opener(opened), embeddings=stub_model)

    first = provider("section")
    second = provider("section")

    assert first is second
    assert isinstance(first, chroma_store.ChromaVectorStore)
    assert opened == ["section"]


def test_provider_gives_each_strategy_its_own_adapter():
    opened = []
    provider = chroma_store.ChromaVectorStoreProvider(open_store=recording_opener(opened), embeddings=stub_model)

    section, page = provider("section"), provider("page")

    assert section is not page
    assert opened == ["section", "page"]


def test_provider_opens_a_strategy_in_its_own_folder_with_the_given_embeddings(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(chroma_store, "Chroma", lambda **kwargs: calls.append(kwargs) or FakeChroma())
    monkeypatch.setattr(chroma_store, "chroma_dir", lambda name: tmp_path / name)

    chroma_store.ChromaVectorStoreProvider(embeddings=stub_model)("section")

    assert calls == [{
        "collection_name": chroma_store.COLLECTION_NAME,
        "persist_directory": str(tmp_path / "section"),
        "embedding_function": stub_model,
    }]


def test_provider_without_embeddings_uses_the_default_ones_when_it_opens(monkeypatch):
    received = []
    monkeypatch.setattr(chroma_store, "default_embeddings", lambda: stub_model)
    provider = chroma_store.ChromaVectorStoreProvider(open_store=lambda strategy, embeddings: received.append(embeddings) or FakeChroma())

    provider("section")

    assert provider.embeddings is stub_model
    assert received == [stub_model]


def test_invalidate_makes_only_that_strategy_reopen_on_the_next_request():
    opened = []
    provider = chroma_store.ChromaVectorStoreProvider(open_store=recording_opener(opened), embeddings=stub_model)
    section = provider("section")
    page = provider("page")

    provider.invalidate("section")

    assert provider("section") is not section
    assert provider("page") is page
    assert opened == ["section", "page", "section"]


def test_invalidate_of_a_strategy_never_opened_does_nothing():
    provider = chroma_store.ChromaVectorStoreProvider(open_store=recording_opener([]), embeddings=stub_model)

    provider.invalidate("never-opened")  # no error


def test_close_drops_every_adapter_so_each_strategy_reopens():
    opened = []
    provider = chroma_store.ChromaVectorStoreProvider(open_store=recording_opener(opened), embeddings=stub_model)
    provider("section")
    provider("page")

    provider.close()
    provider("section")
    provider("page")

    assert opened == ["section", "page", "section", "page"]


def test_adapter_rebuild_replaces_its_strategy_collection(monkeypatch, tmp_path):
    existing = FakeChroma()
    rebuilt = FakeChroma()
    calls = []
    monkeypatch.setattr(chroma_store, "Chroma", SimpleNamespace(
        from_documents=lambda documents, embeddings, **kwargs: calls.append((documents, embeddings, kwargs)) or rebuilt,
    ))
    monkeypatch.setattr(chroma_store, "chroma_dir", lambda name: tmp_path / name)
    documents = [SimpleNamespace(page_content="chunk")]
    adapter = chroma_store.ChromaVectorStore(existing, "section", stub_model)

    adapter.rebuild(documents)

    assert existing.deleted == 1
    assert adapter._store is rebuilt
    assert calls == [(documents, stub_model, {
        "collection_name": chroma_store.COLLECTION_NAME,
        "persist_directory": str(tmp_path / "section"),
    })]


def test_rebuild_keeps_the_cached_adapter_and_searches_the_new_store(monkeypatch, tmp_path):
    existing = FakeChroma()
    rebuilt = FakeChroma()
    monkeypatch.setattr(chroma_store, "Chroma", SimpleNamespace(from_documents=lambda documents, embeddings, **kwargs: rebuilt))
    monkeypatch.setattr(chroma_store, "chroma_dir", lambda name: tmp_path / name)
    provider = chroma_store.ChromaVectorStoreProvider(open_store=lambda strategy, embeddings: existing, embeddings=stub_model)
    adapter = provider("section")

    adapter.rebuild([SimpleNamespace(page_content="chunk")])

    assert provider("section") is adapter  # the cached adapter survives the rebuild
    assert adapter.search_by_vector([1.0, 0.0], limit=1)[0].page_content == "alpha"
    assert rebuilt.search_calls == [([1.0, 0.0], 1)]
    assert existing.search_calls == []


def test_default_provider_is_one_instance_per_process():
    from assistant.storage import factory

    factory.reset_default_vector_store_provider()
    try:
        assert factory.default_vector_store_provider() is factory.default_vector_store_provider()
    finally:
        factory.reset_default_vector_store_provider()


def test_resetting_the_default_provider_makes_the_next_call_build_a_new_one():
    from assistant.storage import factory

    factory.reset_default_vector_store_provider()
    try:
        first = factory.default_vector_store_provider()
        factory.reset_default_vector_store_provider()

        assert factory.default_vector_store_provider() is not first
    finally:
        factory.reset_default_vector_store_provider()


def test_vector_store_contract_imports_without_chroma_or_ollama():
    root = Path(__file__).parents[2]
    code = (
        "import sys; from assistant.storage.vector_store import VectorStore; "
        "assert 'langchain_chroma' not in sys.modules; "
        "assert 'langchain_ollama' not in sys.modules"
    )

    result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr


def test_storage_factory_imports_without_loading_chroma():
    root = Path(__file__).parents[2]
    code = (
        "import sys; from assistant.storage.factory import default_vector_store_provider; "
        "assert 'langchain_chroma' not in sys.modules; "
        "assert 'langchain_ollama' not in sys.modules"
    )

    result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
