"""Small orchestration service that composes a RAG config and its storage provider."""
from collections.abc import Callable, Iterable

from assistant.retrieval import pipeline
from assistant.retrieval.pipeline import AnswerResult, RagConfig, RetrievalResult
from assistant.storage.vector_store import VectorStore


class RagService:
    def __init__(
        self,
        config: RagConfig,
        vector_store_provider: Callable[[str], VectorStore],
    ):
        if vector_store_provider is None:
            raise ValueError("vector_store_provider is required")
        self.config = config
        self.vector_store_provider = vector_store_provider

    def retrieve(self, question: str) -> RetrievalResult:
        return pipeline.retrieve_with_store(question, self.config, vector_store_provider=self.vector_store_provider)

    def answer(self, question: str, history: list[dict[str, str]] | None = None) -> AnswerResult:
        return pipeline.answer_with_store(
            question,
            self.config,
            history,
            vector_store_provider=self.vector_store_provider,
        )

    def stream_answer(self, question: str) -> Iterable[str]:
        return pipeline.stream_answer_with_store(
            question,
            self.config,
            vector_store_provider=self.vector_store_provider,
        )
