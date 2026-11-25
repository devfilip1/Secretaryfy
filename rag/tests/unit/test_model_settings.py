import os
import subprocess
import sys
from pathlib import Path

import pytest

from assistant.config import NVIDIA_PRODUCTION_REFUSAL, resolve_model_settings
from assistant.generation.model import OllamaChat, build_generator
from assistant.openai_compat import OpenAICompatChat, OpenAICompatEmbeddings
from assistant.storage.embeddings import PrefixedEmbeddings, build_embeddings

SECRET = "sk-very-secret-value"
RAG_ROOT = Path(__file__).parents[2]


def test_no_variables_means_ollama_with_its_default_models():
    settings = resolve_model_settings({})

    assert settings.provider == "ollama"
    assert settings.base_url == "http://127.0.0.1:11434"
    assert settings.chat_model == "qwen3:8b"
    assert settings.embedding_model == "embeddinggemma"


def test_ollama_models_come_from_the_ollama_variables():
    settings = resolve_model_settings({"OLLAMA_CHAT_MODEL": "llama3", "OLLAMA_EMBEDDING_MODEL": "bge-m3"})

    assert (settings.chat_model, settings.embedding_model) == ("llama3", "bge-m3")


def test_nvidia_needs_only_the_key_and_takes_its_preset():
    settings = resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET})

    assert settings.base_url == "https://integrate.api.nvidia.com/v1"
    assert settings.chat_model == "nvidia/nemotron-3-ultra-550b-a55b"
    assert settings.embedding_model == "nvidia/nemotron-3.5-embed-8b"
    assert settings.extra_body == {"chat_template_kwargs": {"enable_thinking": False}}
    assert settings.max_per_minute == 35
    assert settings.timeout_s == 60.0
    assert settings.api_key == SECRET


def test_variables_override_the_preset():
    settings = resolve_model_settings({
        "MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, "MODEL_NAME": "other/chat",
        "MODEL_MAX_PER_MINUTE": "10", "MODEL_TIMEOUT_S": "5", "MODEL_MAX_TOKENS": "300",
        "MODEL_EXTRA_BODY": '{"top_p": 0.9}',
    })

    assert settings.chat_model == "other/chat"
    assert settings.max_per_minute == 10
    assert settings.timeout_s == 5.0
    assert settings.max_tokens == 300
    assert settings.extra_body == {"top_p": 0.9}  # replaces the preset's extra body as a whole


def test_openai_compatible_names_every_missing_variable_but_no_value():
    with pytest.raises(ValueError) as info:
        resolve_model_settings({"MODEL_PROVIDER": "openai-compatible", "MODEL_API_KEY": SECRET})

    message = str(info.value)
    assert "MODEL_BASE_URL" in message
    assert "MODEL_NAME" in message
    assert "MODEL_EMBEDDING_NAME" in message
    assert "MODEL_API_KEY" not in message  # it was given
    assert SECRET not in message


def test_openai_compatible_with_everything_resolves_without_preset():
    settings = resolve_model_settings({
        "MODEL_PROVIDER": "openai-compatible", "MODEL_BASE_URL": "https://llm.example/v1", "MODEL_API_KEY": SECRET,
        "MODEL_NAME": "chat-x", "MODEL_EMBEDDING_NAME": "embed-x",
    })

    assert settings.base_url == "https://llm.example/v1"
    assert settings.max_per_minute is None
    assert settings.extra_body == {}
    assert settings.timeout_s == 20.0


def test_nvidia_in_production_is_refused():
    with pytest.raises(ValueError) as info:
        resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, "NODE_ENV": "production"})

    assert str(info.value) == NVIDIA_PRODUCTION_REFUSAL
    assert SECRET not in str(info.value)


def test_nvidia_outside_production_is_allowed():
    assert resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, "NODE_ENV": "development"})


def test_an_unknown_provider_is_refused_without_echoing_it():
    with pytest.raises(ValueError, match="MODEL_PROVIDER must be one of"):
        resolve_model_settings({"MODEL_PROVIDER": "acme"})


@pytest.mark.parametrize("name, value", [("MODEL_MAX_TOKENS", "lots"), ("MODEL_MAX_PER_MINUTE", "0"),
                                         ("MODEL_TIMEOUT_S", "-1")])
def test_a_bad_number_names_its_variable(name, value):
    with pytest.raises(ValueError) as info:
        resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, name: value})

    assert name in str(info.value)
    assert value not in str(info.value)


def test_extra_body_must_be_a_json_object_and_the_error_hides_it():
    with pytest.raises(ValueError) as info:
        resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, "MODEL_EXTRA_BODY": "[1, 2]"})

    assert "MODEL_EXTRA_BODY" in str(info.value)
    assert "[1, 2]" not in str(info.value)


def run_config(env_overrides, code="import assistant.config as c; print(c.INDEX_DIR)"):
    env = {key: value for key, value in os.environ.items() if not key.startswith(("MODEL_", "OLLAMA_", "INDEX_DIR"))}
    env.update(env_overrides)
    return subprocess.run([sys.executable, "-c", code], cwd=RAG_ROOT, env=env, capture_output=True, text=True)


def test_a_cloud_provider_gets_its_own_index_directory():
    result = run_config({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET})

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().endswith(os.path.join("data", "index-nvidia"))


def test_ollama_keeps_the_default_index_directory():
    result = run_config({"MODEL_PROVIDER": "ollama"})

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().endswith(os.path.join("data", "index"))


def test_an_explicit_index_dir_wins_over_the_provider_suffix():
    result = run_config({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, "INDEX_DIR": "custom-index"})

    assert result.stdout.strip() == "custom-index"


def test_importing_the_config_refuses_nvidia_in_production():
    result = run_config({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET, "NODE_ENV": "production"})

    assert result.returncode != 0
    assert "free NVIDIA Build tier" in result.stderr
    assert SECRET not in result.stderr


def test_build_generator_chooses_the_class_of_the_provider():
    cloud = resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET})

    assert isinstance(build_generator(base_url="http://localhost:9", settings=resolve_model_settings({})), OllamaChat)
    assert isinstance(build_generator(settings=cloud), OpenAICompatChat)


def test_build_embeddings_chooses_the_class_of_the_provider():
    cloud = resolve_model_settings({"MODEL_PROVIDER": "nvidia", "MODEL_API_KEY": SECRET})

    assert isinstance(build_embeddings("embeddinggemma", "http://localhost:9", settings=resolve_model_settings({})),
                      PrefixedEmbeddings)
    provider = build_embeddings(settings=cloud)
    assert isinstance(provider, OpenAICompatEmbeddings)
    assert provider._model == "nvidia/nemotron-3.5-embed-8b"
