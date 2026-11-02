"""Embedding provider of the assistant: the contract the RAG uses, and its Ollama implementation."""
from typing import Protocol

from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings

from assistant.config import OLLAMA_BASE_URL, OLLAMA_EMBEDDING_MODEL


class EmbeddingProvider(Protocol):
    """What the RAG needs from an embedding model. Chroma calls the same two methods."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class PrefixedEmbeddings(Embeddings):
    """Add the task prefixes expected by nomic-embed-text."""

    def __init__(self, model, base_url, inner=None):
        self._inner = OllamaEmbeddings(model=model, base_url=base_url) if inner is None else inner
        self._prefixed = model.startswith("nomic-embed-text")

    def embed_documents(self, texts):
        if self._prefixed:
            texts = [f"search_document: {text}" for text in texts]
        return self._inner.embed_documents(texts)

    def embed_query(self, text):
        if self._prefixed:
            text = f"search_query: {text}"
        return self._inner.embed_query(text)


def build_embeddings(model=OLLAMA_EMBEDDING_MODEL, base_url=OLLAMA_BASE_URL) -> EmbeddingProvider:
    return PrefixedEmbeddings(model, base_url)
