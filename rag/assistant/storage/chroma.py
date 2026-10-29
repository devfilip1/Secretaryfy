"""Chroma implementation of the vector-store contract."""
from functools import lru_cache

from langchain_chroma.vectorstores import Chroma

from assistant.config import COLLECTION_NAME
from assistant.storage.embeddings import EMBEDDINGS
from assistant.index import chroma_dir
from assistant.storage.vector_store import VectorStore


class ChromaVectorStore:
    """Adapts LangChain Chroma operations to the assistant's storage contract."""

    def __init__(self, store, strategy: str):
        self._store = store
        self._strategy = strategy
        self._vectors = None

    def search_by_vector(self, vector, limit):
        return self._store.similarity_search_by_vector(list(vector), k=limit)

    def search_by_text(self, query, limit):
        return self._store.similarity_search(query, k=limit)

    def vectors_by_content(self):
        if self._vectors is None:
            stored = self._store._collection.get(include=["embeddings", "documents"])
            self._vectors = dict(zip(stored["documents"], stored["embeddings"]))
        return self._vectors

    def documents(self):
        return self._store._collection.get(include=["documents"])["documents"]

    def rebuild(self, documents):
        self._store.delete_collection()
        self._store = Chroma.from_documents(
            documents,
            EMBEDDINGS,
            collection_name=COLLECTION_NAME,
            persist_directory=str(chroma_dir(self._strategy)),
        )
        self._vectors = None
        get_vector_store.cache_clear()


def _open_chroma(strategy: str):
    return Chroma(
        collection_name=COLLECTION_NAME,
        persist_directory=str(chroma_dir(strategy)),
        embedding_function=EMBEDDINGS,
    )


@lru_cache(maxsize=None)
def get_vector_store(strategy: str) -> VectorStore:
    """Return the cached Chroma adapter for a chunking strategy."""
    return ChromaVectorStore(_open_chroma(strategy), strategy)
