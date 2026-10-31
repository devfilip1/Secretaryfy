"""Chroma implementation of the vector-store contract."""
from collections.abc import Callable

from langchain_chroma.vectorstores import Chroma

from assistant.config import COLLECTION_NAME
from assistant.index import chroma_dir, index_version
from assistant.storage.embeddings import EmbeddingProvider
from assistant.storage.factory import default_embeddings
from assistant.storage.vector_store import VectorStore


class ChromaVectorStore:
    """Adapts LangChain Chroma operations to the assistant's storage contract."""

    def __init__(self, store, strategy: str, embeddings: EmbeddingProvider):
        self._store = store
        self._strategy = strategy
        self._embeddings = embeddings
        self._vectors = None

    def search_by_vector(self, vector, limit):
        return self._store.similarity_search_by_vector(list(vector), k=limit)

    def vectors_by_content(self):
        if self._vectors is None:
            stored = self._store.get(include=["embeddings", "documents"])
            self._vectors = dict(zip(stored["documents"], stored["embeddings"]))
        return self._vectors

    def documents(self):
        return self._store.get(include=["documents"])["documents"]

    def rebuild(self, documents):
        self._store.delete_collection()
        self._store = Chroma.from_documents(
            documents,
            self._embeddings,
            collection_name=COLLECTION_NAME,
            persist_directory=str(chroma_dir(self._strategy)),
        )
        self._vectors = None


def _open_chroma(strategy: str, embeddings: EmbeddingProvider):
    return Chroma(
        collection_name=COLLECTION_NAME,
        persist_directory=str(chroma_dir(strategy)),
        embedding_function=embeddings,
    )


class ChromaVectorStoreProvider:
    """Creates, reuses and invalidates the Chroma adapters of one process, one per chunking strategy.

    Opening a store is the expensive step, so a strategy's adapter is opened on its first request and kept.
    It is opened again when the index version of the strategy changes, which happens when another process
    rewrites the index; while the version is unknown (no index files) the adapter is kept.
    Whoever holds the provider decides its lifetime. langchain-chroma exposes no explicit close, so close()
    only drops the references to the adapters. The adapters embed with the given model, or with the process
    default when none was given.
    """

    def __init__(self, open_store: Callable[[str, EmbeddingProvider], object] | None = None,
                 embeddings: EmbeddingProvider | None = None,
                 version: Callable[[str], str | None] | None = None):
        self._open = _open_chroma if open_store is None else open_store
        self._embeddings = embeddings
        self._version = index_version if version is None else version
        self._stores: dict[str, tuple[str | None, ChromaVectorStore]] = {}

    @property
    def embeddings(self) -> EmbeddingProvider:
        return default_embeddings() if self._embeddings is None else self._embeddings

    def __call__(self, strategy: str) -> VectorStore:
        version = self._version(strategy)
        cached = self._stores.get(strategy)
        if cached is not None and (version is None or cached[0] == version):
            return cached[1]
        embeddings = self.embeddings
        adapter = ChromaVectorStore(self._open(strategy, embeddings), strategy, embeddings)
        self._stores[strategy] = (version, adapter)
        return adapter

    def invalidate(self, strategy: str) -> None:
        """Drops the cached adapter of one strategy; the next request reopens it from disk."""
        self._stores.pop(strategy, None)

    def close(self) -> None:
        """Drops every cached adapter; the next request of each strategy reopens it from disk."""
        self._stores.clear()
