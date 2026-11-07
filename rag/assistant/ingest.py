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
    save_chunks,
    split_by_characters,
    split_by_page,
    split_by_section,
    split_sections,
    vectorize_chunks,
)
from assistant.composition import build_knowledge_source, build_vector_store_provider
from assistant.ingestion.service import main as _main
from assistant.ingestion.source import KnowledgeSource
from assistant.storage.vector_store import VectorStore


def main(
    argv=None,
    *,
    vector_store_provider: Callable[[str], VectorStore] | None = None,
    knowledge_source: KnowledgeSource | None = None,
):
    """CLI entry point: without a provider or a source, the composition root chooses them."""
    provider = build_vector_store_provider() if vector_store_provider is None else vector_store_provider
    source = build_knowledge_source() if knowledge_source is None else knowledge_source
    return _main(argv, vector_store_provider=provider, knowledge_source=source)


if __name__ == "__main__":
    sys.exit(main())
