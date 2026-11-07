"""Chat model of the assistant: the contract the RAG uses to generate text, and its Ollama implementation."""
import json
from collections.abc import Iterable
from typing import Protocol

from assistant.config import KEEP_ALIVE, OLLAMA_BASE_URL, OLLAMA_THINKING, THINKING_ANSWER_TOKENS

MAX_CACHED_MODELS = 4
# Models that think before answering unless told not to. Thinking is off unless OLLAMA_THINKING is on: it uses the answer budget and slows every answer.
THINKING_MODELS = ("qwen3",)


class TextGenerator(Protocol):
    """What the RAG needs from a chat model. The model name is given per call, because each experiment may use another."""

    def generate(self, prompt, *, model: str, temperature: float | None, seed: int | None, max_tokens: int | None,
                 response_format: dict | None = None) -> str: ...

    def stream(self, prompt, *, model: str, temperature: float | None, seed: int | None,
               max_tokens: int | None) -> Iterable[str]: ...


class OllamaChat:
    """Text generation through Ollama. Keeps the langchain model of the last few combinations of settings."""

    def __init__(self, base_url=OLLAMA_BASE_URL, keep_alive=KEEP_ALIVE, thinking: bool = OLLAMA_THINKING):
        self._base_url = base_url
        self._keep_alive = keep_alive
        self._thinking = thinking
        self._models = {}  # the order is the usage order: the first key is the least recently used

    def generate(self, prompt, *, model, temperature, seed, max_tokens, response_format=None):
        return self._chat_model(model, temperature, seed, max_tokens, response_format).invoke(prompt).content

    def stream(self, prompt, *, model, temperature, seed, max_tokens):
        for piece in self._chat_model(model, temperature, seed, max_tokens).stream(prompt):
            yield piece.content

    def _chat_model(self, model, temperature, seed, max_tokens, response_format=None):
        key = (model, temperature, seed, max_tokens, json.dumps(response_format, sort_keys=True))
        if key in self._models:
            chat = self._models.pop(key)
            self._models[key] = chat  # used now, so it becomes the most recently used
            return chat
        if len(self._models) >= MAX_CACHED_MODELS:
            del self._models[next(iter(self._models))]
        from langchain_ollama import ChatOllama

        options = {}
        if temperature is not None:
            options["temperature"] = temperature
        if seed is not None:
            options["seed"] = seed
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if response_format is not None:
            options["format"] = response_format  # Ollama constrains the reply to this JSON Schema
        if model.startswith(THINKING_MODELS):
            if self._thinking:
                options["reasoning"] = True
                if max_tokens is not None:
                    options["num_predict"] = max(max_tokens, THINKING_ANSWER_TOKENS)
            else:
                options["reasoning"] = False
        chat = ChatOllama(model=model, base_url=self._base_url, keep_alive=self._keep_alive, **options)
        self._models[key] = chat
        return chat


def build_generator(base_url=OLLAMA_BASE_URL, keep_alive=KEEP_ALIVE, thinking=OLLAMA_THINKING) -> TextGenerator:
    return OllamaChat(base_url=base_url, keep_alive=keep_alive, thinking=thinking)
