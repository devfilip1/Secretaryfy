"""Facade and CLI for the modular ingestion package. The CLI resolves the storage backend; the functions take it as argument."""
import sys
from collections.abc import Callable

from assistant.ingestion.service import (
    BULLET,
    HEADING_STOPWORDS,
    PAGE_HEADER,
    STRATEGY_TYPES,
    PrefixedEmbeddings,
    build_chunks,
    build_index,
    clean_text,
    is_heading,
    load_pages,
    save_chunks,
    split_by_characters,
    split_by_page,
    split_by_section,
    split_sections,
    vectorize_chunks,
)
from assistant.composition import build_vector_store_provider
from assistant.ingestion.service import main as _main
from assistant.storage.vector_store import VectorStore


def main(argv=None, *, vector_store_provider: Callable[[str], VectorStore] | None = None):
    """CLI entry point: without a provider, the composition root chooses the backend."""
    provider = build_vector_store_provider() if vector_store_provider is None else vector_store_provider
    return _main(argv, vector_store_provider=provider)


if __name__ == "__main__":
    sys.exit(main())
