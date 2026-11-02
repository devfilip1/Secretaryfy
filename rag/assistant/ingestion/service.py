import json
import sys
from collections.abc import Callable
from pathlib import Path

from assistant.ingestion.chunking import (
    HEADING_STOPWORDS,
    STRATEGY_TYPES,
    build_chunks,
    is_heading,
    split_by_characters,
    split_by_page,
    split_by_section,
    split_sections,
)
from assistant.ingestion.pdf_source import BULLET, PAGE_HEADER, clean_text
from assistant.ingestion.source import KnowledgeDocument, KnowledgeSource
from assistant.storage.embeddings import PrefixedEmbeddings
from assistant.index import chunks_path, index_dir, write_manifest
from assistant.settings import SettingsError, load_settings
from assistant.storage.vector_store import VectorStore


def save_chunks(strategy, chunks):
    data = []

    for chunk in chunks:
        data.append({
            "content": chunk.page_content,
            "metadata": chunk.metadata
        })

    index_dir(strategy.name).mkdir(parents=True, exist_ok=True)
    with open(chunks_path(strategy.name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def vectorize_chunks(strategy, chunks, *, vector_store_provider: Callable[[str], VectorStore]):
    """Replace a strategy's vector index through the required storage port."""
    store = vector_store_provider(strategy.name)
    store.rebuild(chunks)
    return store


def _stored_dimensions(store):
    """Size of the stored vectors, for the manifest; None when the index is empty or the store cannot tell."""
    vectors_by_content = getattr(store, "vectors_by_content", None)
    if vectors_by_content is None:
        return None
    stored = vectors_by_content()
    return len(next(iter(stored.values()))) if stored else None


def build_index(strategy, document: KnowledgeDocument, *, vector_store_provider: Callable[[str], VectorStore]):
    """Creates or recreates the index of one strategy, without touching the indexes of the others."""
    chunks = build_chunks(strategy, document)
    save_chunks(strategy, chunks)
    store = vectorize_chunks(strategy, chunks, vector_store_provider=vector_store_provider)
    write_manifest(strategy, len(chunks), source=document.version, embedding_dimensions=_stored_dimensions(store))
    return len(chunks)


RAG_ROOT = Path(__file__).resolve().parents[2]


def shown_index_dir(name):
    """Where the index of a strategy lives, for the user: relative to the rag folder when it is inside it."""
    path = index_dir(name).resolve()
    try:
        return path.relative_to(RAG_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def main(argv=None, *, vector_store_provider: Callable[[str], VectorStore], knowledge_source: KnowledgeSource):
    """python -m assistant.ingest [STRATEGY...] — with no arguments, builds the indexes of all of them."""
    names = list(sys.argv[1:] if argv is None else argv)
    try:
        declared = load_settings().strategies
    except SettingsError as error:
        print(f"Invalid configuration: {len(error.problems)} problem(s)")
        for problem in error.problems:
            print(f"  - {problem}")
        return 2

    unknown = [name for name in names if name not in declared]
    if unknown:
        print(f"Unknown strategy: {', '.join(unknown)}. Use one of: {', '.join(declared)}")
        return 2

    document = knowledge_source.load()
    for name in names or declared:
        count = build_index(declared[name], document, vector_store_provider=vector_store_provider)
        print(f"{name}: {count} chunks in {shown_index_dir(name)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
