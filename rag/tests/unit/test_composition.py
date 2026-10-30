import subprocess
import sys
from pathlib import Path

import pytest

from assistant import composition
from assistant.retrieval import pipeline
from assistant.retrieval.pipeline import RagConfig
from assistant.retrieval.service import RagService


def test_build_rag_service_serves_the_given_config_from_the_default_provider(monkeypatch):
    provider = lambda strategy: pytest.fail("the store is not used when the service is only inspected")
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: provider)
    config = RagConfig.from_experiment("section_hybrid")

    service = composition.build_rag_service(config)

    assert isinstance(service, RagService)
    assert service.config is config
    assert service.vector_store_provider is provider


def test_build_rag_service_without_a_config_uses_the_assistant_experiment(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: (lambda strategy: None))
    monkeypatch.setattr(pipeline, "RagConfig", lambda: sentinel)

    service = composition.build_rag_service()

    assert service.config is sentinel


def test_build_vector_store_provider_is_the_default_factory_provider(monkeypatch):
    provider = lambda strategy: None
    monkeypatch.setattr(composition, "default_vector_store_provider", lambda: provider)

    assert composition.build_vector_store_provider() is provider


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
