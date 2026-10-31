"""Small orchestration service that composes a RAG config, its storage provider, its embedding model, its chat model and its lexical index."""
from collections.abc import Callable, Iterable

from assistant.generation.model import TextGenerator
from assistant.retrieval import pipeline
from assistant.retrieval.lexical import LexicalIndex
from assistant.retrieval.pipeline import AnswerResult, RagConfig, RetrievalResult
from assistant.storage.embeddings import EmbeddingProvider
from assistant.storage.vector_store import VectorStore


class RagService:
    def __init__(
        self,
        config: RagConfig,
        vector_store_provider: Callable[[str], VectorStore],
        embeddings: EmbeddingProvider,
        generator: TextGenerator,
        lexical: LexicalIndex,
    ):
        if vector_store_provider is None:
            raise ValueError("vector_store_provider is required")
        if embeddings is None:
            raise ValueError("embeddings is required")
        if generator is None:
            raise ValueError("generator is required")
        if lexical is None:
            raise ValueError("lexical is required")
        self.config = config
        self.vector_store_provider = vector_store_provider
        self.embeddings = embeddings
        self.generator = generator
        self.lexical = lexical

    def retrieve(self, question: str) -> RetrievalResult:
        return pipeline.retrieve_with_store(
            question,
            self.config,
            vector_store_provider=self.vector_store_provider,
            embeddings=self.embeddings,
            generator=self.generator,
            lexical=self.lexical,
        )

    def answer(self, question: str, history: list[dict[str, str]] | None = None) -> AnswerResult:
        return pipeline.answer_with_store(
            question,
            self.config,
            history,
            vector_store_provider=self.vector_store_provider,
            embeddings=self.embeddings,
            generator=self.generator,
            lexical=self.lexical,
        )

    def stream_answer(self, question: str) -> Iterable[str]:
        return pipeline.stream_answer_with_store(
            question,
            self.config,
            vector_store_provider=self.vector_store_provider,
            embeddings=self.embeddings,
            generator=self.generator,
            lexical=self.lexical,
        )
