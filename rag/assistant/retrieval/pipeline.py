import json
import math
import re
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from langchain_ollama import ChatOllama
from rank_bm25 import BM25Okapi

from assistant.config import (
    KEEP_ALIVE,
    MAX_ANSWER_TOKENS,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_MODEL,
    OLLAMA_EMBEDDING_MODEL,
    QUERY_SYNONYMS,
    STOPWORDS,
    TEMPERATURE,
)
from assistant.storage.embeddings import EMBEDDINGS
from assistant.retrieval.fusion import RRF_K, reciprocal_rank_fusion
from assistant.index import chunks_path
from assistant.settings import assistant_experiment, get_experiment
from assistant.generation.prompting import (
    HYDE_MAX_TOKENS,
    HYDE_PROMPT,
    NO_ANSWER,
    NO_CONVERSATION,
    NO_INFORMATION,
    ORIGINAL_SEPARATOR,
    ORIGINAL_TEMPLATE,
    STANDALONE_MAX_TOKENS,
    SYSTEM_PROMPT,
    USER_TEMPLATE,
    build_prompt as _build_prompt,
    clean_answer,
    format_conversation,
    prompt_text,
    standalone_question_prompt,
)
from assistant.storage.vector_store import VectorStore

@dataclass(frozen=True)
class RagConfig:
    """Configuration of the assistant. The search fields come from an experiment in config/experiments.yaml.

    RagConfig() uses the experiment named in "assistant:"; RagConfig.from_experiment(name) uses another one.
    """
    experiment: str | None = None
    strategy: str | None = None
    search_type: str | None = None
    match_count: int | None = None
    match_threshold: float | None = None
    use_hyde: bool | None = None
    prompt: str | None = None  # "rules" (the assistant's) or "original" (the baseline)
    chat_model: str = OLLAMA_CHAT_MODEL
    embedding_model: str = OLLAMA_EMBEDDING_MODEL
    temperature: float | None = TEMPERATURE
    seed: int | None = None
    max_answer_tokens: int | None = MAX_ANSWER_TOKENS
    prompt_template: str = SYSTEM_PROMPT
    user_template: str = USER_TEMPLATE

    def __post_init__(self):
        search_fields = {
            "experiment": "exp_name", "strategy": "collection", "search_type": "search_type",
            "match_count": "match_count", "match_threshold": "match_threshold", "use_hyde": "use_hyde",
            "prompt": "prompt",
        }
        missing = [name for name in search_fields if getattr(self, name) is None]
        if missing:
            experiment = assistant_experiment()
            for name in missing:
                object.__setattr__(self, name, getattr(experiment, search_fields[name]))

    @classmethod
    def from_experiment(cls, experiment, **overrides):
        """Builds the configuration from an experiment (the object or its name)."""
        if isinstance(experiment, str):
            experiment = get_experiment(experiment)
        return cls(
            experiment=experiment.exp_name,
            strategy=experiment.collection,
            search_type=experiment.search_type,
            match_count=experiment.match_count,
            match_threshold=experiment.match_threshold,
            use_hyde=experiment.use_hyde,
            prompt=experiment.prompt,
            **overrides,
        )

    # In hybrid search each search contributes half of match_count (rounded up).
    @property
    def vector_k(self):
        if self.search_type == "bm25":
            return 0
        return self.match_count if self.search_type == "vector" else math.ceil(self.match_count / 2)

    @property
    def bm25_k(self):
        if self.search_type == "vector":
            return 0
        return self.match_count if self.search_type == "bm25" else math.ceil(self.match_count / 2)

    @property
    def final_k(self):
        return self.match_count


@dataclass(frozen=True)
class RetrievedChunk:
    content: str
    rank: int
    score: float | None = None       # each search's own score (cosine, BM25, or fusion)
    similarity: float | None = None  # cosine between the searched text and the chunk, from 0 to 1


@dataclass(frozen=True)
class RetrievalResult:
    vector: list[RetrievedChunk]
    bm25: list[RetrievedChunk]
    fused: list[RetrievedChunk]


@dataclass(frozen=True)
class AnswerResult:
    answer: str
    retrieval: RetrievalResult
    latency_s: float


def _default_vector_store_provider() -> Callable[[str], VectorStore]:
    from assistant.storage.factory import default_vector_store_provider

    return default_vector_store_provider()


@lru_cache(maxsize=None)
def _bm25(strategy):
    with open(chunks_path(strategy), "r", encoding="utf-8") as f:
        documents = [item["content"] for item in json.load(f)]

    tokenized_docs = [tokenize(doc) for doc in documents]
    return BM25Okapi(tokenized_docs), documents


@lru_cache(maxsize=4)
def _model(chat_model, temperature, seed, max_answer_tokens):
    options = {}
    if temperature is not None:
        options["temperature"] = temperature
    if seed is not None:
        options["seed"] = seed
    if max_answer_tokens is not None:
        options["num_predict"] = max_answer_tokens
    return ChatOllama(model=chat_model, base_url=OLLAMA_BASE_URL, keep_alive=KEEP_ALIVE, **options)


def _unit(vector):
    vector = np.asarray(vector, dtype=float)
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def tokenize(text, expand=False):
    """Words without accents, punctuation, stop words, or the plural "s".

    expand=True adds the brochure's terms that mean the same as the question's ("cost" -> "price").
    """
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    tokens = []
    for word in re.findall(r"[a-z0-9]+", text):
        if word in STOPWORDS:
            continue
        words = [word, *QUERY_SYNONYMS.get(word, ())] if expand else [word]
        for word in words:
            if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
                word = word[:-1]
            tokens.append(word)
    return tokens


def hypothetical_answer(question, config):
    """HyDE's hypothetical answer: a text in the brochure's style, which sits closer to the chunks than the question does."""
    model = _model(config.chat_model, 0.0, config.seed, HYDE_MAX_TOKENS)
    return model.invoke(HYDE_PROMPT.format(ask=question)).content.strip()


def _search_vector(question, config):
    """Vector used in the search and in the similarity computation, with norm 1."""
    if config.use_hyde:
        # the hypothetical answer is a document text, so it gets the document prefix
        return _unit(EMBEDDINGS.embed_documents([hypothetical_answer(question, config)])[0])
    return _unit(EMBEDDINGS.embed_query(question))


def retrieve_with_store(question, config, *, vector_store_provider: Callable[[str], VectorStore]):
    config = config or RagConfig()
    query_vector = _search_vector(question, config)
    store = vector_store_provider(config.strategy)
    vectors = {content: _unit(embedding) for content, embedding in store.vectors_by_content().items()}

    def similarity(content):
        return max(0.0, min(1.0, float(vectors[content] @ query_vector)))

    # VECTOR SEARCH
    vector = []
    if config.vector_k > 0:
        results = store.search_by_vector(query_vector.tolist(), limit=config.vector_k)
        for rank, doc in enumerate(results, start=1):
            value = similarity(doc.page_content)
            vector.append(RetrievedChunk(doc.page_content, rank, value, value))

    # BM25 SEARCH (always with the original question, even with HyDE)
    lexical = []
    if config.bm25_k > 0:
        bm25, documents = _bm25(config.strategy)
        scores = bm25.get_scores(tokenize(question, expand=True))
        ranked_docs = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)[:config.bm25_k]
        lexical = [
            RetrievedChunk(doc, rank, float(score), similarity(doc))
            for rank, (doc, score) in enumerate(ranked_docs, start=1)
            if score > 0
        ]

    best = reciprocal_rank_fusion((vector, lexical), config.final_k, rank_constant=RRF_K)

    # THRESHOLD: chunks that are not similar enough to the question do not go to the model (0 turns it off)
    kept = [(content, score) for content, score in best if similarity(content) >= config.match_threshold]
    fused = [
        RetrievedChunk(content, rank, score, similarity(content)) for rank, (content, score) in enumerate(kept, start=1)
    ]

    return RetrievalResult(vector=vector, bm25=lexical, fused=fused)


def retrieve(question, config=None, *, vector_store_provider: Callable[[str], VectorStore] | None = None):
    """Legacy entry point; resolves Chroma when callers omit an explicit provider."""
    provider = (
        _default_vector_store_provider()
        if vector_store_provider is None
        else vector_store_provider
    )
    return retrieve_with_store(question, config or RagConfig(), vector_store_provider=provider)


def standalone_question(question, history, config):
    """The question to search with: the same one without a conversation, or rewritten to stand alone with it."""
    if not history:
        return question
    model = _model(config.chat_model, 0.0, config.seed, STANDALONE_MAX_TOKENS)
    prompt = standalone_question_prompt(question, history)
    rewritten = model.invoke(prompt).content.strip().strip('"').strip()
    return rewritten or question


def build_prompt(question, retrieval, config=None, history=None):
    """Compatibility facade that supplies the configured experiment when omitted."""
    return _build_prompt(question, retrieval, config or RagConfig(), history)


def answer_with_store(question, config, history, *, vector_store_provider: Callable[[str], VectorStore]):
    """history: the messages before the question, as [{"role": "user" | "assistant", "content": ...}]."""
    config = config or RagConfig()
    start = time.perf_counter()

    retrieval = retrieve_with_store(
        standalone_question(question, history, config),
        config,
        vector_store_provider=vector_store_provider,
    )
    prompt = build_prompt(question, retrieval, config, history)
    model = _model(config.chat_model, config.temperature, config.seed, config.max_answer_tokens)
    response = model.invoke(prompt)

    return AnswerResult(answer=clean_answer(response.content, history), retrieval=retrieval, latency_s=time.perf_counter() - start)


def answer(question, config=None, history=None, *, vector_store_provider: Callable[[str], VectorStore] | None = None):
    """Legacy entry point; resolves Chroma when callers omit an explicit provider."""
    provider = (
        _default_vector_store_provider()
        if vector_store_provider is None
        else vector_store_provider
    )
    return answer_with_store(question, config or RagConfig(), history, vector_store_provider=provider)


def stream_answer_with_store(question, config, *, vector_store_provider: Callable[[str], VectorStore]):
    """Generates the answer in pieces, so the chat shows the text while it is being written."""
    config = config or RagConfig()
    retrieval = retrieve_with_store(question, config, vector_store_provider=vector_store_provider)
    prompt = build_prompt(question, retrieval, config)
    model = _model(config.chat_model, config.temperature, config.seed, config.max_answer_tokens)
    for piece in model.stream(prompt):
        yield piece.content


def stream_answer(question, config=None, *, vector_store_provider: Callable[[str], VectorStore] | None = None):
    """Legacy entry point; resolves Chroma when callers omit an explicit provider."""
    provider = (
        _default_vector_store_provider()
        if vector_store_provider is None
        else vector_store_provider
    )
    yield from stream_answer_with_store(question, config or RagConfig(), vector_store_provider=provider)
