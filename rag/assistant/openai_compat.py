"""Cloud models through the OpenAI-compatible API (chat/completions and embeddings), for MODEL_PROVIDER=openai-compatible
and nvidia. The local Ollama stays in generation/model.py and storage/embeddings.py.

OpenAICompatClient holds everything the two endpoints share: the HTTP client, the Bearer key, the retries after 429 (with
retry-after), the client-side limiter, the counters and the error text with the key masked. The subclasses only build
their request and read their reply.
"""
import math
import threading
import time
from collections.abc import Callable
from functools import partial

import httpx
from langchain_core.embeddings import Embeddings

from assistant.generation.model import TextGenerator
from assistant.storage.embeddings import EmbeddingProvider

MAX_ATTEMPTS = 3
DEFAULT_WAIT_S = 2.0
MAX_WAIT_S = 30.0
MINUTE_S = 60.0
EMBEDDING_BATCH = 16
ERROR_SNIPPET_CHARS = 200
REPLY_SCHEMA_NAME = "reply"
ROLES = {"system": "system", "human": "user", "user": "user", "ai": "assistant", "assistant": "assistant"}


class ModelUnavailable(Exception):
    """The cloud model gave no usable answer: unreachable, still rate limited, an error status or a bad reply.
    Its message never carries the API key."""


def _retry_wait(response):
    """The wait the server asks for in retry-after, in seconds, at most 30; 2 seconds without a valid value."""
    try:
        seconds = float(response.headers.get("retry-after"))
    except (TypeError, ValueError):
        return DEFAULT_WAIT_S
    if not math.isfinite(seconds) or seconds < 0:
        return DEFAULT_WAIT_S
    return min(seconds, MAX_WAIT_S)


class OpenAICompatClient:
    """One OpenAI-compatible endpoint: POST JSON with a Bearer key, retry after 429, at most max_per_minute HTTP requests
    per minute, and counters (calls, rate_limited, failed) for stats()."""

    def __init__(self, base_url, api_key, *, timeout_s, max_per_minute=None, transport=None,
                 sleep=time.sleep, now=time.monotonic):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._client = httpx.Client(timeout=timeout_s, transport=transport)
        self._spacing_s = MINUTE_S / max_per_minute if max_per_minute else 0.0
        self._next_slot = 0.0
        self._slot_lock = threading.Lock()
        self._counter_lock = threading.Lock()
        self._counters = {"calls": 0, "rate_limited": 0, "failed": 0}
        self._sleep = sleep
        self._now = now

    def stats(self):
        with self._counter_lock:
            return dict(self._counters)

    def _count(self, name):
        with self._counter_lock:
            self._counters[name] += 1

    def _wait_for_slot(self):
        """Reserves the next free moment for an HTTP request and sleeps until it. Requests get their turn in call order."""
        if not self._spacing_s:
            return
        with self._slot_lock:
            current = self._now()
            slot = max(current, self._next_slot)
            self._next_slot = slot + self._spacing_s
        if slot > current:
            self._sleep(slot - current)

    def _attempt(self, path, body):
        self._wait_for_slot()
        try:
            return self._client.post(f"{self._base_url}{path}", json=body,
                                     headers={"Authorization": f"Bearer {self._api_key}"})
        except httpx.HTTPError as error:
            raise ModelUnavailable(f"model unreachable: {type(error).__name__}") from error

    def _snippet(self, response):
        text = response.text
        if self._api_key:
            text = text.replace(self._api_key, "***")
        return text[:ERROR_SNIPPET_CHARS]

    def _send(self, path, body):
        for attempt in range(1, MAX_ATTEMPTS + 1):
            response = self._attempt(path, body)
            if response.status_code == 429:
                self._count("rate_limited")
                if attempt < MAX_ATTEMPTS:
                    self._sleep(_retry_wait(response))
                    continue
                raise ModelUnavailable(f"rate limit (429) after {MAX_ATTEMPTS} attempts")
            if not response.is_success:
                raise ModelUnavailable(f"model answered {response.status_code}: {self._snippet(response)}")
            try:
                return response.json()
            except ValueError as error:
                raise ModelUnavailable("model reply is not JSON") from error

    def _post(self, path, body, parse: Callable[[dict], object]):
        """The one entry point of the subclasses: sends body to path and returns parse(reply). Counts the call, and a
        failure whatever its cause."""
        self._count("calls")
        try:
            return parse(self._send(path, body))
        except ModelUnavailable:
            self._count("failed")
            raise


def _message(item):
    if isinstance(item, dict):
        role, content = item["role"], item["content"]
    else:  # a langchain message
        role, content = item.type, item.content
    return {"role": ROLES.get(role, "user"), "content": content}


def _messages(prompt):
    """The prompt as chat messages: a string is one user message; a langchain prompt value gives its messages."""
    if isinstance(prompt, str):
        return [{"role": "user", "content": prompt}]
    items = prompt.to_messages() if hasattr(prompt, "to_messages") else list(prompt)
    return [_message(item) for item in items]


def _reply_text(data):
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise ModelUnavailable("model reply has no message") from error
    return content or ""  # a reasoning model that ran out of tokens may send no content: the RAG treats it as invalid


def _vectors(data, size):
    try:
        items = sorted(data["data"], key=lambda item: item["index"])
        vectors = [item["embedding"] for item in items]
    except (KeyError, TypeError) as error:
        raise ModelUnavailable("embedding reply has no vectors") from error
    if len(vectors) != size:
        raise ModelUnavailable(f"embedding reply has {len(vectors)} vectors for {size} texts")
    return vectors


class OpenAICompatChat(OpenAICompatClient, TextGenerator):
    """Text generation through chat/completions. stream() yields the whole reply as one piece: the RAG checks the JSON of
    grounded answers as a whole, and nothing would reach the chat sooner with SSE."""

    def __init__(self, base_url, api_key, *, extra_body=None, max_tokens=None, **client_options):
        super().__init__(base_url, api_key, **client_options)
        self._extra_body = dict(extra_body or {})
        self._max_tokens = max_tokens

    def generate(self, prompt, *, model, temperature, seed, max_tokens, response_format=None):
        body = {"model": model, "messages": _messages(prompt)}
        if temperature is not None:
            body["temperature"] = temperature
        cap = max_tokens if max_tokens is not None else self._max_tokens
        if cap is not None:
            body["max_tokens"] = cap
        if seed is not None:
            body["seed"] = seed
        if response_format is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": REPLY_SCHEMA_NAME, "schema": response_format, "strict": True},
            }
        body.update(self._extra_body)
        return self._post("/chat/completions", body, _reply_text)

    def stream(self, prompt, *, model, temperature, seed, max_tokens):
        yield self.generate(prompt, model=model, temperature=temperature, seed=seed, max_tokens=max_tokens)


class OpenAICompatEmbeddings(OpenAICompatClient, Embeddings, EmbeddingProvider):
    """Embeddings through the embeddings endpoint: "passage" for stored texts, "query" for questions, no prefixes."""

    def __init__(self, base_url, api_key, model, **client_options):
        super().__init__(base_url, api_key, **client_options)
        self._model = model

    def embed_documents(self, texts):
        return self._embed(list(texts), "passage")

    def embed_query(self, text):
        return self._embed([text], "query")[0]

    def _embed(self, texts, input_type):
        vectors = []
        for start in range(0, len(texts), EMBEDDING_BATCH):
            batch = texts[start:start + EMBEDDING_BATCH]
            body = {"model": self._model, "input": batch, "input_type": input_type, "truncate": "END",
                    "encoding_format": "float"}
            vectors.extend(self._post("/embeddings", body, partial(_vectors, size=len(batch))))
        return vectors

