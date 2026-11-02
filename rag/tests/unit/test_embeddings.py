import subprocess
import sys
from pathlib import Path

import pytest
from langchain_ollama import OllamaEmbeddings

from assistant.storage import embeddings as embeddings_module
from assistant.storage import factory
from assistant.storage.embeddings import PrefixedEmbeddings, build_embeddings


class FakeInner:
    """Stands in for the Ollama client: records what it was asked and answers with the length of the text."""

    def __init__(self):
        self.documents = []
        self.queries = []

    def embed_documents(self, texts):
        self.documents.append(list(texts))
        return [[float(len(text)), 1.0] for text in texts]

    def embed_query(self, text):
        self.queries.append(text)
        return [float(len(text)), 1.0]


def test_nomic_documents_get_the_search_document_prefix():
    inner = FakeInner()
    provider = PrefixedEmbeddings("nomic-embed-text", "http://127.0.0.1:9", inner=inner)

    vectors = provider.embed_documents(["Price: $40"])

    assert inner.documents == [["search_document: Price: $40"]]
    assert vectors == [[float(len("search_document: Price: $40")), 1.0]]


def test_nomic_questions_get_the_search_query_prefix():
    inner = FakeInner()
    provider = PrefixedEmbeddings("nomic-embed-text", "http://127.0.0.1:9", inner=inner)

    provider.embed_query("how much")

    assert inner.queries == ["search_query: how much"]


@pytest.mark.parametrize("model", ["bge-m3", "all-minilm"])
def test_other_models_get_no_prefix(model):
    inner = FakeInner()
    provider = PrefixedEmbeddings(model, "http://127.0.0.1:9", inner=inner)

    provider.embed_documents(["Price: $40"])
    provider.embed_query("how much")

    assert inner.documents == [["Price: $40"]]
    assert inner.queries == ["how much"]


def test_build_embeddings_wraps_an_ollama_model_of_the_given_name():
    provider = build_embeddings("nomic-embed-text", "http://127.0.0.1:9")

    assert isinstance(provider, PrefixedEmbeddings)
    assert isinstance(provider._inner, OllamaEmbeddings)
    assert provider._inner.model == "nomic-embed-text"


def test_default_embeddings_is_one_instance_per_process(monkeypatch):
    built = []
    shared = object()
    monkeypatch.setattr(embeddings_module, "build_embeddings", lambda: built.append(1) or shared)
    factory.reset_default_embeddings()
    try:
        assert factory.default_embeddings() is factory.default_embeddings() is shared
        assert built == [1]
    finally:
        factory.reset_default_embeddings()


def test_resetting_the_default_embeddings_builds_a_new_instance(monkeypatch):
    built = []
    monkeypatch.setattr(embeddings_module, "build_embeddings", lambda: built.append(1) or object())
    factory.reset_default_embeddings()
    try:
        first = factory.default_embeddings()
        factory.reset_default_embeddings()

        assert factory.default_embeddings() is not first
        assert built == [1, 1]
    finally:
        factory.reset_default_embeddings()


def test_importing_the_embedding_modules_creates_no_ollama_client():
    root = Path(__file__).parents[2]
    code = (
        "import langchain_ollama\n"
        "def refuse(self, *args, **kwargs):\n"
        "    raise AssertionError('an import must not create an Ollama client')\n"
        "langchain_ollama.OllamaEmbeddings.__init__ = refuse\n"
        "import assistant.storage.embeddings, assistant.storage.factory\n"
    )

    result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
