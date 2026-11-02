"""Composition root of the process: the one place that chooses the concrete backends and builds the services.

The entry points (chat, server, ingest CLI, evaluation) get their dependencies from here; the modules below it take them as arguments.
"""
from collections.abc import Callable
from typing import TYPE_CHECKING

from assistant.storage.factory import default_embeddings, default_generator, default_lexical_index, default_vector_store_provider
from assistant.storage.vector_store import VectorStore

if TYPE_CHECKING:
    from assistant.generation.model import TextGenerator
    from assistant.retrieval.lexical import LexicalIndex
    from assistant.retrieval.pipeline import RagConfig, RagDeps
    from assistant.retrieval.service import RagService
    from assistant.storage.embeddings import EmbeddingProvider


def build_vector_store_provider() -> Callable[[str], VectorStore]:
    return default_vector_store_provider()


def build_embeddings_provider() -> "EmbeddingProvider":
    return default_embeddings()


def build_generator_provider() -> "TextGenerator":
    return default_generator()


def build_lexical_provider() -> "LexicalIndex":
    return default_lexical_index()


def build_rag_deps() -> "RagDeps":
    # imported here, not at the top: importing this module must not load the retrieval pipeline (numpy, langchain_ollama)
    from assistant.retrieval.pipeline import RagDeps

    return RagDeps(
        vector_store_provider=build_vector_store_provider(),
        embeddings=build_embeddings_provider(),
        generator=build_generator_provider(),
        lexical=build_lexical_provider(),
    )


def build_rag_service(config: "RagConfig | None" = None) -> "RagService":
    from assistant.retrieval.pipeline import RagConfig
    from assistant.retrieval.service import RagService

    return RagService(config or RagConfig(), build_rag_deps())
