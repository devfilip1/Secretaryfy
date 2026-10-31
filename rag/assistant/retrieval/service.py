"""Small orchestration service: a RAG config with the dependencies the pipeline takes from outside."""
from collections.abc import Iterable

from assistant.retrieval import pipeline
from assistant.retrieval.pipeline import AnswerResult, RagConfig, RagDeps, RetrievalResult

_REQUIRED_DEPS = ("vector_store_provider", "embeddings", "generator", "lexical")


class RagService:
    def __init__(self, config: RagConfig, deps: RagDeps):
        if deps is None:
            raise ValueError("deps is required")
        for name in _REQUIRED_DEPS:
            if getattr(deps, name) is None:
                raise ValueError(f"{name} is required")
        self.config = config
        self.deps = deps

    def retrieve(self, question: str) -> RetrievalResult:
        return pipeline.retrieve(question, self.config, self.deps)

    def answer(self, question: str, history: list[dict[str, str]] | None = None) -> AnswerResult:
        return pipeline.answer(question, self.config, history, self.deps)

    def stream_answer(self, question: str) -> Iterable[str]:
        return pipeline.stream_answer(question, self.config, self.deps)
