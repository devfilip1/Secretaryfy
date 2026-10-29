"""Default storage-provider composition without importing a backend for injected fakes."""
from collections.abc import Callable

from assistant.storage.vector_store import VectorStore


def default_vector_store_provider() -> Callable[[str], VectorStore]:
    from assistant.storage.chroma import get_vector_store

    return get_vector_store
