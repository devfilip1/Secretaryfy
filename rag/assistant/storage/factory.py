"""Default storage and embedding composition without importing a backend for injected fakes."""
from collections.abc import Callable

from assistant.storage.vector_store import VectorStore

# One instance per process: the legacy wrappers ask for them on every question, and they must not be rebuilt each time.
_default_provider: Callable[[str], VectorStore] | None = None
_default_embeddings_instance = None


def default_embeddings():
    global _default_embeddings_instance
    if _default_embeddings_instance is None:
        from assistant.storage.embeddings import build_embeddings

        _default_embeddings_instance = build_embeddings()
    return _default_embeddings_instance


def reset_default_embeddings() -> None:
    """Forgets the process-wide embedding model, so the next call builds a new one. Used by tests."""
    global _default_embeddings_instance
    _default_embeddings_instance = None


def default_vector_store_provider() -> Callable[[str], VectorStore]:
    global _default_provider
    if _default_provider is None:
        from assistant.storage.chroma import ChromaVectorStoreProvider

        _default_provider = ChromaVectorStoreProvider(embeddings=default_embeddings())
    return _default_provider


def reset_default_vector_store_provider() -> None:
    """Forgets the process-wide provider, so the next call builds a new one. Used by tests."""
    global _default_provider
    _default_provider = None
