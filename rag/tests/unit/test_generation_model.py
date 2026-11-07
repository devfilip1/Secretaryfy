import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from assistant.generation import model as generation_model
from assistant.generation.model import OllamaChat, build_generator


@pytest.fixture
def built(monkeypatch):
    """Replaces langchain_ollama.ChatOllama with a fake that records each model instance it builds."""
    import langchain_ollama

    constructed = []

    class FakeChatModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            constructed.append(self)

        def invoke(self, prompt):
            return SimpleNamespace(content=f"answer to {prompt}")

        def stream(self, prompt):
            yield SimpleNamespace(content="Braces ")
            yield SimpleNamespace(content="cost.")

    monkeypatch.setattr(langchain_ollama, "ChatOllama", FakeChatModel)
    return constructed


def test_only_the_options_that_are_set_reach_the_model(built):
    chat = OllamaChat(base_url="http://localhost:9", keep_alive="5m")

    chat.generate("hi", model="llama3", temperature=0.0, seed=None, max_tokens=50)

    assert built[0].kwargs == {
        "model": "llama3", "base_url": "http://localhost:9", "keep_alive": "5m", "temperature": 0.0, "num_predict": 50,
    }


def test_qwen3_models_get_thinking_turned_off(built):
    OllamaChat().generate("hi", model="qwen3:8b", temperature=None, seed=None, max_tokens=None)

    assert built[0].kwargs["reasoning"] is False


def test_models_other_than_qwen3_get_no_reasoning_argument(built):
    OllamaChat().generate("hi", model="llama3", temperature=None, seed=None, max_tokens=None)

    assert "reasoning" not in built[0].kwargs


def test_qwen3_small_models_get_thinking_turned_off(built):
    OllamaChat().generate("hi", model="qwen3:4b", temperature=None, seed=None, max_tokens=None)

    assert built[0].kwargs["reasoning"] is False


def test_thinking_on_turns_thinking_on_and_raises_the_answer_budget(built):
    OllamaChat(thinking=True).generate("hi", model="qwen3:8b", temperature=None, seed=None, max_tokens=200)

    assert built[0].kwargs["reasoning"] is True
    assert built[0].kwargs["num_predict"] >= 2000


def test_thinking_on_without_a_token_cap_leaves_num_predict_unset(built):
    OllamaChat(thinking=True).generate("hi", model="qwen3:8b", temperature=None, seed=None, max_tokens=None)

    assert built[0].kwargs["reasoning"] is True
    assert "num_predict" not in built[0].kwargs


@pytest.mark.parametrize("thinking", [False, True])
def test_models_other_than_qwen3_are_the_same_whatever_the_thinking_setting(built, thinking):
    OllamaChat(thinking=thinking).generate("hi", model="llama3", temperature=None, seed=None, max_tokens=50)

    assert "reasoning" not in built[0].kwargs
    assert built[0].kwargs["num_predict"] == 50


def test_the_same_settings_reuse_the_model_and_other_settings_build_another(built):
    chat = OllamaChat()

    chat.generate("a", model="llama3", temperature=0.0, seed=1, max_tokens=10)
    chat.generate("b", model="llama3", temperature=0.0, seed=1, max_tokens=10)
    chat.generate("c", model="llama3", temperature=0.5, seed=1, max_tokens=10)

    assert len(built) == 2


def test_the_cache_keeps_four_models_and_drops_the_least_recently_used(built):
    chat = OllamaChat()

    def ask(seed):
        chat.generate("x", model="llama3", temperature=0.0, seed=seed, max_tokens=None)

    for seed in (1, 2, 3, 4):
        ask(seed)
    ask(1)  # a hit: seed 1 becomes the most recently used
    ask(5)  # the fifth model evicts seed 2, the least recently used
    assert len(built) == 5

    for seed in (1, 3, 4, 5):
        ask(seed)
    assert len(built) == 5  # all still cached

    ask(2)  # was evicted, so it is built again
    assert len(built) == 6


def test_each_chat_has_its_own_cache(built):
    OllamaChat().generate("a", model="llama3", temperature=0.0, seed=1, max_tokens=None)
    OllamaChat().generate("a", model="llama3", temperature=0.0, seed=1, max_tokens=None)

    assert len(built) == 2


def test_generate_returns_the_text_of_the_reply(built):
    assert OllamaChat().generate("hi", model="m", temperature=None, seed=None, max_tokens=None) == "answer to hi"


def test_stream_yields_the_pieces_of_the_reply(built):
    assert list(OllamaChat().stream("hi", model="m", temperature=None, seed=None, max_tokens=None)) == ["Braces ", "cost."]


def test_build_generator_returns_an_ollama_chat():
    assert isinstance(build_generator(base_url="http://localhost:9"), OllamaChat)


def test_default_generator_is_one_instance_per_process(monkeypatch):
    from assistant.storage import factory

    built_by = []
    shared = object()
    monkeypatch.setattr(generation_model, "build_generator", lambda: built_by.append(1) or shared)
    factory.reset_default_generator()
    try:
        assert factory.default_generator() is factory.default_generator() is shared
        assert built_by == [1]
    finally:
        factory.reset_default_generator()


def test_resetting_the_default_generator_builds_a_new_one(monkeypatch):
    from assistant.storage import factory

    built_by = []
    monkeypatch.setattr(generation_model, "build_generator", lambda: built_by.append(1) or object())
    factory.reset_default_generator()
    try:
        first = factory.default_generator()
        factory.reset_default_generator()

        assert factory.default_generator() is not first
        assert built_by == [1, 1]
    finally:
        factory.reset_default_generator()


def test_importing_the_generation_model_does_not_load_langchain_ollama():
    root = Path(__file__).parents[2]
    code = "import sys; import assistant.generation.model; assert 'langchain_ollama' not in sys.modules"

    result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr


def test_response_format_reaches_the_model_as_format(built):
    OllamaChat().generate("hi", model="llama3", temperature=None, seed=None, max_tokens=None, response_format={"type": "object"})

    assert built[0].kwargs["format"] == {"type": "object"}


def test_response_format_is_part_of_the_cache_key(built):
    chat = OllamaChat()

    chat.generate("a", model="llama3", temperature=None, seed=None, max_tokens=None)
    chat.generate("a", model="llama3", temperature=None, seed=None, max_tokens=None, response_format={"type": "object"})

    assert len(built) == 2
    assert "format" not in built[0].kwargs