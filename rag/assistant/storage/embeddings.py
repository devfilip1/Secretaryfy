"""Embedding provider of the assistant: the contract the RAG uses, and its Ollama implementation."""
from typing import Protocol

from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings

from assistant.config import OLLAMA_BASE_URL, OLLAMA_EMBEDDING_MODEL


class EmbeddingProvider(Protocol):
    """What the RAG needs from an embedding model. Chroma calls the same two methods."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


# (prefix of a question, prefix of a stored text), by the start of the model name. A model that is not here gets the text as it is.
PREFIXES = {
    "nomic-embed-text": ("search_query: ", "search_document: "),
    "embeddinggemma": ("task: search result | query: ", "title: none | text: "),
}


class PrefixedEmbeddings(Embeddings):
    """Add the task prefixes the model expects, from PREFIXES."""

    def __init__(self, model, base_url, inner=None):
        self._inner = OllamaEmbeddings(model=model, base_url=base_url) if inner is None else inner
        self._prefixes = next((pair for key, pair in PREFIXES.items() if model.startswith(key)), None)

    def embed_documents(self, texts):
        if self._prefixes:
            _, document_prefix = self._prefixes
            texts = [f"{document_prefix}{text}" for text in texts]
        return self._inner.embed_documents(texts)

    def embed_query(self, text):
        if self._prefixes:
            query_prefix, _ = self._prefixes
            text = f"{query_prefix}{text}"
        return self._inner.embed_query(text)


def build_embeddings(model=OLLAMA_EMBEDDING_MODEL, base_url=OLLAMA_BASE_URL) -> EmbeddingProvider:
    return PrefixedEmbeddings(model, base_url)
