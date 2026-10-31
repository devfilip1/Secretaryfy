import math
import time
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from assistant.config import (
    MAX_ANSWER_TOKENS,
    OLLAMA_CHAT_MODEL,
    OLLAMA_EMBEDDING_MODEL,
    TEMPERATURE,
)
from assistant.generation.model import TextGenerator
from assistant.storage.embeddings import EmbeddingProvider
from assistant.retrieval.fusion import RRF_K, reciprocal_rank_fusion
from assistant.index import EmbeddingMismatch, IndexInconsistent, ingest_command
from assistant.retrieval.lexical import LexicalIndex, tokenize
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


@dataclass(frozen=True)
class RagDeps:
    """What the pipeline takes from outside: the vector stores, the embedding model, the chat model and the BM25 index."""
    vector_store_provider: Callable[[str], VectorStore]
    embeddings: EmbeddingProvider
    generator: TextGenerator
    lexical: LexicalIndex


def _unit(vector):
    vector = np.asarray(vector, dtype=float)
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def hypothetical_answer(question, config, generator: TextGenerator):
    """HyDE's hypothetical answer: a text in the brochure's style, which sits closer to the chunks than the question does."""
    text = generator.generate(
        HYDE_PROMPT.format(ask=question),
        model=config.chat_model,
        temperature=0.0,
        seed=config.seed,
        max_tokens=HYDE_MAX_TOKENS,
    )
    return text.strip()


def _search_vector(question, config, embeddings: EmbeddingProvider, generator: TextGenerator | None):
    """Vector used in the search and in the similarity computation, with norm 1."""
    if config.use_hyde:
        # the hypothetical answer is a document text, so it gets the document prefix
        return _unit(embeddings.embed_documents([hypothetical_answer(question, config, generator)])[0])
    return _unit(embeddings.embed_query(question))


def _check_dimensions(query_vector, stored, strategy):
    """Refuses a query whose vector has another size than the stored ones: comparing them would be meaningless."""
    if not stored:
        return
    indexed = len(next(iter(stored.values())))
    if len(query_vector) != indexed:
        raise EmbeddingMismatch(
            f'the embedding model returned {len(query_vector)} dimensions but the index of strategy "{strategy}" '
            f"has {indexed}; run: {ingest_command(strategy)}"
        )


def retrieve(question, config, deps: RagDeps):
    """The chunks that answer the question: vector search, word search, their fusion, and the similarity cut."""
    config = config or RagConfig()
    query_vector = _search_vector(question, config, deps.embeddings, deps.generator)
    store = deps.vector_store_provider(config.strategy)
    stored = store.vectors_by_content()
    _check_dimensions(query_vector, stored, config.strategy)
    vectors = {content: _unit(embedding) for content, embedding in stored.items()}

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
    bm25_chunks = []
    if config.bm25_k > 0:
        bm25, documents = deps.lexical.get(config.strategy)
        missing = [document for document in documents if document not in vectors]
        if missing:
            raise IndexInconsistent(
                f'the index of strategy "{config.strategy}" is inconsistent: chunks.json holds {len(missing)} chunk(s) '
                f"the vector store does not; run: {ingest_command(config.strategy)}"
            )
        scores = bm25.get_scores(tokenize(question, expand=True))
        ranked_docs = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)[:config.bm25_k]
        bm25_chunks = [
            RetrievedChunk(doc, rank, float(score), similarity(doc))
            for rank, (doc, score) in enumerate(ranked_docs, start=1)
            if score > 0
        ]

    best = reciprocal_rank_fusion((vector, bm25_chunks), config.final_k, rank_constant=RRF_K)

    # THRESHOLD: chunks that are not similar enough to the question do not go to the model (0 turns it off)
    kept = [(content, score) for content, score in best if similarity(content) >= config.match_threshold]
    fused = [
        RetrievedChunk(content, rank, score, similarity(content)) for rank, (content, score) in enumerate(kept, start=1)
    ]

    return RetrievalResult(vector=vector, bm25=bm25_chunks, fused=fused)


def standalone_question(question, history, config, generator: TextGenerator):
    """The question to search with: the same one without a conversation, or rewritten to stand alone with it."""
    if not history:
        return question
    rewritten = generator.generate(
        standalone_question_prompt(question, history),
        model=config.chat_model,
        temperature=0.0,
        seed=config.seed,
        max_tokens=STANDALONE_MAX_TOKENS,
    )
    rewritten = rewritten.strip().strip('"').strip()
    return rewritten or question


def build_prompt(question, retrieval, config=None, history=None):
    """Compatibility facade that supplies the configured experiment when omitted."""
    return _build_prompt(question, retrieval, config or RagConfig(), history)


def answer(question, config, history, deps: RagDeps):
    """history: the messages before the question, as [{"role": "user" | "assistant", "content": ...}]."""
    config = config or RagConfig()
    start = time.perf_counter()

    retrieval = retrieve(standalone_question(question, history, config, deps.generator), config, deps)
    prompt = build_prompt(question, retrieval, config, history)
    reply = deps.generator.generate(
        prompt,
        model=config.chat_model,
        temperature=config.temperature,
        seed=config.seed,
        max_tokens=config.max_answer_tokens,
    )

    return AnswerResult(answer=clean_answer(reply, history), retrieval=retrieval, latency_s=time.perf_counter() - start)


def stream_answer(question, config, deps: RagDeps):
    """Generates the answer in pieces, so the chat shows the text while it is being written."""
    config = config or RagConfig()
    retrieval = retrieve(question, config, deps)
    prompt = build_prompt(question, retrieval, config)
    yield from deps.generator.stream(
        prompt,
        model=config.chat_model,
        temperature=config.temperature,
        seed=config.seed,
        max_tokens=config.max_answer_tokens,
    )

