"""Embedding provider shared by Chroma indexing and query encoding."""
from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings

from assistant.config import OLLAMA_BASE_URL, OLLAMA_EMBEDDING_MODEL


class PrefixedEmbeddings(Embeddings):
    """Add the task prefixes expected by nomic-embed-text."""

    def __init__(self, model, base_url):
        self._inner = OllamaEmbeddings(model=model, base_url=base_url)
        self._prefixed = model.startswith("nomic-embed-text")

    def embed_documents(self, texts):
        if self._prefixed:
            texts = [f"search_document: {text}" for text in texts]
        return self._inner.embed_documents(texts)

    def embed_query(self, text):
        if self._prefixed:
            text = f"search_query: {text}"
        return self._inner.embed_query(text)


EMBEDDINGS = PrefixedEmbeddings(OLLAMA_EMBEDDING_MODEL, OLLAMA_BASE_URL)
