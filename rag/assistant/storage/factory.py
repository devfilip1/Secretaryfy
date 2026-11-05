"""Default storage, embedding and generation composition without importing a backend for injected fakes."""
from collections.abc import Callable

from assistant.storage.vector_store import VectorStore

# One instance per process: the legacy wrappers ask for them on every question, and they must not be rebuilt each time.
_default_provider: Callable[[str], VectorStore] | None = None
_default_embeddings_instance = None
_default_generator_instance = None
_default_chunk_source_instance = None
_default_clinic_instance = None
_default_lexical_instance = None
_default_knowledge_instance = None


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


def default_generator():
    global _default_generator_instance
    if _default_generator_instance is None:
        from assistant.generation.model import build_generator

        _default_generator_instance = build_generator()
    return _default_generator_instance


def reset_default_generator() -> None:
    """Forgets the process-wide chat model, so the next call builds a new one. Used by tests."""
    global _default_generator_instance
    _default_generator_instance = None


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


def default_chunk_source():
    global _default_chunk_source_instance
    if _default_chunk_source_instance is None:
        from assistant.retrieval.chunks import JsonChunkSource

        _default_chunk_source_instance = JsonChunkSource()
    return _default_chunk_source_instance


def reset_default_chunk_source() -> None:
    """Forgets the process-wide chunk source, so the next call builds a new one. Used by tests."""
    global _default_chunk_source_instance
    _default_chunk_source_instance = None


def default_clinic_profile():
    """The clinic profile of the process: the lexical index and the pipeline read the same one."""
    global _default_clinic_instance
    if _default_clinic_instance is None:
        from assistant.clinic.yaml_source import YamlClinicProfile
        from assistant.config import CLINIC_PATH, LANGUAGES_DIR

        _default_clinic_instance = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR)
    return _default_clinic_instance


def reset_default_clinic_profile() -> None:
    """Forgets the process-wide clinic profile, so the next call builds a new one. Used by tests."""
    global _default_clinic_instance
    _default_clinic_instance = None


def default_lexical_index():
    global _default_lexical_instance
    if _default_lexical_instance is None:
        from assistant.retrieval.lexical import LexicalIndex

        _default_lexical_instance = LexicalIndex(default_chunk_source(), default_clinic_profile())
    return _default_lexical_instance


def reset_default_lexical_index() -> None:
    """Forgets the process-wide lexical index, so the next call builds a new one. Used by tests."""
    global _default_lexical_instance
    _default_lexical_instance = None


def default_knowledge_source():
    """The knowledge source of the process: the index checks its version and the ingestion reads its document."""
    global _default_knowledge_instance
    if _default_knowledge_instance is None:
        from assistant.config import (
            IGNORED_LINE_PREFIXES, INTERNAL_TOKEN, INTRO_SECTION_SUFFIX, KNOWLEDGE_URL, ROOT, SOURCE_PDF, TEXT_FIXES,
        )
        from assistant.ingestion.http_source import HttpKnowledgeSource
        from assistant.ingestion.markdown_source import MarkdownKnowledgeSource
        from assistant.ingestion.pdf_source import PdfBrochureSource

        if KNOWLEDGE_URL:
            _default_knowledge_instance = HttpKnowledgeSource(KNOWLEDGE_URL, INTERNAL_TOKEN)
            return _default_knowledge_instance

        path = SOURCE_PDF.resolve()
        name = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.name
        if path.suffix.lower() == ".pdf":
            _default_knowledge_instance = PdfBrochureSource(
                path,
                name=name,
                text_fixes=TEXT_FIXES,
                ignored_line_prefixes=IGNORED_LINE_PREFIXES,
                intro_suffix=INTRO_SECTION_SUFFIX,
            )
        else:
            _default_knowledge_instance = MarkdownKnowledgeSource(path, name=name)
    return _default_knowledge_instance


def reset_default_knowledge_source() -> None:
    """Forgets the process-wide knowledge source, so the next call builds a new one. Used by tests."""
    global _default_knowledge_instance
    _default_knowledge_instance = None
