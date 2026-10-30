"""Default storage-provider composition without importing a backend for injected fakes."""
from collections.abc import Callable

from assistant.storage.vector_store import VectorStore

# One provider per process: the legacy wrappers ask for it on every question, and it must not reopen Chroma each time.
_default_provider: Callable[[str], VectorStore] | None = None


def default_vector_store_provider() -> Callable[[str], VectorStore]:
    global _default_provider
    if _default_provider is None:
        from assistant.storage.chroma import ChromaVectorStoreProvider

        _default_provider = ChromaVectorStoreProvider()
    return _default_provider


def reset_default_vector_store_provider() -> None:
    """Forgets the process-wide provider, so the next call builds a new one. Used by tests."""
    global _default_provider
    _default_provider = None
