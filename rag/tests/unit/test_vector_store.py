import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from assistant.storage import chroma as chroma_store
from assistant.storage import vector_store


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


def test_chroma_adapter_maps_search_and_embedding_operations(monkeypatch):
    backend = FakeChroma()
    adapter = chroma_store.ChromaVectorStore(backend, "section")

    assert adapter.search_by_vector([1.0, 0.0], limit=3)[0].page_content == "alpha"
    assert adapter.search_by_text("question", limit=2)[0].page_content == "beta"
    assert adapter.vectors_by_content() == {"alpha": [1.0, 0.0], "beta": [0.0, 1.0]}
    assert backend.search_calls == [([1.0, 0.0], 3), ("question", 2)]


def test_get_vector_store_builds_cached_chroma_adapter(monkeypatch, tmp_path):
    backend = FakeChroma()
    calls = []
    monkeypatch.setattr(chroma_store, "Chroma", lambda **kwargs: calls.append(kwargs) or backend)
    monkeypatch.setattr(chroma_store, "chroma_dir", lambda name: tmp_path / name)
    chroma_store.get_vector_store.cache_clear()
    try:
        first = chroma_store.get_vector_store("section")
        second = chroma_store.get_vector_store("section")
    finally:
        chroma_store.get_vector_store.cache_clear()

    assert first is second
    assert isinstance(first, chroma_store.ChromaVectorStore)
    assert calls == [{
        "collection_name": chroma_store.COLLECTION_NAME,
        "persist_directory": str(tmp_path / "section"),
        "embedding_function": chroma_store.EMBEDDINGS,
    }]


def test_adapter_rebuild_replaces_its_strategy_collection(monkeypatch, tmp_path):
    existing = FakeChroma()
    rebuilt = FakeChroma()
    calls = []
    monkeypatch.setattr(chroma_store, "Chroma", SimpleNamespace(
        from_documents=lambda documents, embeddings, **kwargs: calls.append((documents, embeddings, kwargs)) or rebuilt,
    ))
    monkeypatch.setattr(chroma_store, "chroma_dir", lambda name: tmp_path / name)
    documents = [SimpleNamespace(page_content="chunk")]
    adapter = chroma_store.ChromaVectorStore(existing, "section")

    adapter.rebuild(documents)

    assert existing.deleted == 1
    assert adapter._store is rebuilt
    assert calls == [(documents, chroma_store.EMBEDDINGS, {
        "collection_name": chroma_store.COLLECTION_NAME,
        "persist_directory": str(tmp_path / "section"),
    })]


def test_vector_store_contract_imports_without_chroma_or_ollama():
    root = Path(__file__).parents[2]
    code = (
        "import sys; from assistant.storage.vector_store import VectorStore; "
        "assert 'langchain_chroma' not in sys.modules; "
        "assert 'langchain_ollama' not in sys.modules"
    )

    result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
