"""Compatibility facade and CLI for the modular ingestion package."""
import sys
from collections.abc import Callable

from assistant.ingestion.service import (
    BULLET,
    HEADING_STOPWORDS,
    PAGE_HEADER,
    STRATEGY_TYPES,
    PrefixedEmbeddings,
    build_chunks,
    build_index as _build_index,
    clean_text,
    is_heading,
    load_pages,
    main as _main,
    save_chunks,
    split_by_characters,
    split_by_page,
    split_by_section,
    split_sections,
    vectorize_chunks as _vectorize_chunks,
)
from assistant.composition import build_vector_store_provider
from assistant.storage.factory import default_vector_store_provider
from assistant.storage.vector_store import VectorStore


def vectorize_chunks(
    strategy,
    chunks,
    *,
    vector_store_provider: Callable[[str], VectorStore] | None = None,
):
    """Legacy convenience wrapper; omitted providers use the configured default backend."""
    provider = (
        default_vector_store_provider()
        if vector_store_provider is None
        else vector_store_provider
    )
    return _vectorize_chunks(strategy, chunks, vector_store_provider=provider)


def build_index(
    strategy,
    pages=None,
    *,
    vector_store_provider: Callable[[str], VectorStore] | None = None,
):
    """Legacy convenience wrapper; omitted providers use the configured default backend."""
    provider = (
        default_vector_store_provider()
        if vector_store_provider is None
        else vector_store_provider
    )
    return _build_index(strategy, pages, vector_store_provider=provider)


def main(argv=None, *, vector_store_provider: Callable[[str], VectorStore] | None = None):
    """CLI entry point: without a provider, the composition root chooses the backend."""
    provider = build_vector_store_provider() if vector_store_provider is None else vector_store_provider
    return _main(argv, vector_store_provider=provider)

if __name__ == "__main__":
    sys.exit(main())
