import subprocess
import sys
from pathlib import Path

import pytest

from assistant import composition
from assistant.retrieval import pipeline
from assistant.retrieval.pipeline import RagConfig
from assistant.retrieval.service import RagService
from assistant.storage import embeddings as embeddings_module
from assistant.storage import factory

stub_model = object()  # stands in for the embedding model; nothing here calls it


def test_build_rag_service_serves_the_given_config_from_the_default_provider_and_embeddings(monkeypatch):
    provider = lambda strategy: pytest.fail("the store is not used when the service is only inspected")
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: provider)
    monkeypatch.setattr(composition, "default_embeddings", lambda: stub_model)
    monkeypatch.setattr(composition, "default_generator", lambda: stub_model)
    config = RagConfig.from_experiment("section_hybrid")

    service = composition.build_rag_service(config)

    assert isinstance(service, RagService)
    assert service.config is config
    assert service.deps.vector_store_provider is provider
    assert service.deps.embeddings is stub_model


def test_build_rag_service_without_a_config_uses_the_assistant_experiment(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: (lambda strategy: None))
    monkeypatch.setattr(composition, "default_embeddings", lambda: stub_model)
    monkeypatch.setattr(composition, "default_generator", lambda: stub_model)
    monkeypatch.setattr(pipeline, "RagConfig", lambda: sentinel)

    service = composition.build_rag_service()

    assert service.config is sentinel


def test_build_rag_service_passes_the_process_lexical_index(monkeypatch):
    lexical = object()
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: (lambda strategy: None))
    monkeypatch.setattr(composition, "default_embeddings", lambda: stub_model)
    monkeypatch.setattr(composition, "default_generator", lambda: stub_model)
    monkeypatch.setattr(composition, "default_lexical_index", lambda: lexical)

    service = composition.build_rag_service(RagConfig.from_experiment("section_hybrid"))

    assert service.deps.lexical is lexical
    assert composition.build_lexical_provider() is lexical


def test_build_vector_store_provider_is_the_default_factory_provider(monkeypatch):
    provider = lambda strategy: None
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: provider)

    assert composition.build_vector_store_provider() is provider


def test_build_embeddings_provider_is_the_default_embeddings(monkeypatch):
    monkeypatch.setattr(composition, "default_embeddings", lambda: stub_model)
    monkeypatch.setattr(composition, "default_generator", lambda: stub_model)

    assert composition.build_embeddings_provider() is stub_model


def test_the_service_and_the_chroma_provider_share_one_embeddings_instance(monkeypatch):
    shared = object()
    monkeypatch.setattr(embeddings_module, "build_embeddings", lambda: shared)
    factory.reset_default_embeddings()
    factory.reset_default_vector_store_provider()
    try:
        service = composition.build_rag_service(RagConfig.from_experiment("section_hybrid"))

        assert service.deps.embeddings is shared
        assert service.deps.vector_store_provider.embeddings is shared
    finally:
        factory.reset_default_embeddings()
        factory.reset_default_vector_store_provider()


def test_the_service_and_the_chat_model_share_one_generator(monkeypatch):
    from assistant.generation import model as generation_model

    shared = object()
    monkeypatch.setattr(generation_model, "build_generator", lambda: shared)
    factory.reset_default_generator()
    try:
        service = composition.build_rag_service(RagConfig.from_experiment("section_hybrid"))

        assert service.deps.generator is shared
    finally:
        factory.reset_default_generator()


def test_importing_the_composition_root_does_not_load_the_retrieval_pipeline():
    root = Path(__file__).parents[2]
    code = (
        "import sys; import assistant.composition; "
        "assert 'assistant.retrieval.pipeline' not in sys.modules; "
        "assert 'langchain_ollama' not in sys.modules; "
        "assert 'numpy' not in sys.modules"
    )

    result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr


def test_build_rag_deps_takes_the_defaults_of_the_process(monkeypatch):
    from assistant.retrieval.pipeline import RagDeps

    provider = lambda strategy: None
    lexical = object()
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: provider)
    monkeypatch.setattr(composition, "default_embeddings", lambda: stub_model)
    monkeypatch.setattr(composition, "default_generator", lambda: stub_model)
    monkeypatch.setattr(composition, "default_lexical_index", lambda: lexical)

    deps = composition.build_rag_deps()

    assert deps == RagDeps(vector_store_provider=provider, embeddings=stub_model, generator=stub_model, lexical=lexical)


def test_the_legacy_pipeline_alias_is_gone():
    import importlib.util

    assert importlib.util.find_spec("assistant.pipeline") is None
