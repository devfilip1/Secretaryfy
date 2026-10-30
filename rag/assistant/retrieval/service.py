"""Small orchestration service that composes a RAG config, its storage provider and its embedding model."""
from collections.abc import Callable, Iterable

from assistant.retrieval import pipeline
from assistant.retrieval.pipeline import AnswerResult, RagConfig, RetrievalResult
from assistant.storage.embeddings import EmbeddingProvider
from assistant.storage.vector_store import VectorStore


class RagService:
    def __init__(
        self,
        config: RagConfig,
        vector_store_provider: Callable[[str], VectorStore],
        embeddings: EmbeddingProvider,
    ):
        if vector_store_provider is None:
            raise ValueError("vector_store_provider is required")
        if embeddings is None:
            raise ValueError("embeddings is required")
        self.config = config
        self.vector_store_provider = vector_store_provider
        self.embeddings = embeddings

    def retrieve(self, question: str) -> RetrievalResult:
        return pipeline.retrieve_with_store(
            question,
            self.config,
            vector_store_provider=self.vector_store_provider,
            embeddings=self.embeddings,
        )

    def answer(self, question: str, history: list[dict[str, str]] | None = None) -> AnswerResult:
        return pipeline.answer_with_store(
            question,
            self.config,
            history,
            vector_store_provider=self.vector_store_provider,
            embeddings=self.embeddings,
        )

    def stream_answer(self, question: str) -> Iterable[str]:
        return pipeline.stream_answer_with_store(
            question,
            self.config,
            vector_store_provider=self.vector_store_provider,
            embeddings=self.embeddings,
        )
