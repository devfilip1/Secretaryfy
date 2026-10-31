from types import SimpleNamespace

import numpy as np
import pytest

from assistant.retrieval import pipeline
from assistant.retrieval.pipeline import (
    NO_ANSWER,
    NO_CONVERSATION,
    NO_INFORMATION,
    RagConfig,
    RagDeps,
    build_prompt,
    retrieve,
    standalone_question,
    tokenize,
)
from assistant.index import IndexInconsistent
from assistant.retrieval.lexical import LexicalIndex
from assistant.settings import Experiment

CLEANING = "Dental Cleaning — The First Step Toward a Healthy Smile\nDuration: 30–50 minutes\nPrice: $40–$85"
WHITENING = "Teeth Whitening — Whiter Teeth\nRemove stains from coffee\nPrice: $180–$450"
BRACES = "Braces and Orthodontic Treatment — A Straight Smile\nOptions: Traditional braces or clear aligners\nDuration: 12–36 months"
IMPLANTS = "Dental Implants — Tooth Back\nA titanium post\nDuration: 3–6 months"
DOCUMENTS = [CLEANING, WHITENING, BRACES, IMPLANTS]

# Fake 2-dimensional embeddings. The question vector is always (1, 0), so the similarity of each
# chunk is the first component of its vector (with norm 1).
VECTORS = {
    CLEANING: np.array([0.9, np.sqrt(1 - 0.81)]),
    WHITENING: np.array([0.8, 0.6]),
    IMPLANTS: np.array([0.6, 0.8]),
    BRACES: np.array([0.3, np.sqrt(1 - 0.09)]),
}
SIMILARITY = {CLEANING: 0.9, WHITENING: 0.8, IMPLANTS: 0.6, BRACES: 0.3}

PRICE_QUESTION = "How much does whitening cost?"
BRACES_QUESTION = "how long do braces take"  # the vector search ranks the braces last


def config(search_type="hybrid", match_count=4, match_threshold=0.0, use_hyde=False):
    return RagConfig(experiment="test", strategy="fake", search_type=search_type, match_count=match_count,
                     match_threshold=match_threshold, use_hyde=use_hyde)


class FakeChunkSource:
    """The chunks of the in-memory index. Counts the reads, which happen once per index version."""

    def __init__(self, texts, calls):
        self.texts, self.calls = texts, calls

    def version(self, strategy):
        return "v1"

    def chunks(self, strategy):
        self.calls.bm25 += 1
        return list(self.texts)


LEXICAL = LexicalIndex(FakeChunkSource(DOCUMENTS, SimpleNamespace(bm25=0)))


class UnusedGenerator:
    """The model of the calls that never use it: calling it is a failure."""

    def generate(self, prompt, **kwargs):
        raise AssertionError("the model must not be called")

    def stream(self, prompt, **kwargs):
        raise AssertionError("the model must not be called")


UNUSED_GENERATOR = UnusedGenerator()


@pytest.fixture
def index(monkeypatch):
    """In-memory index. Records what was asked of each search and of the models."""
    calls = SimpleNamespace(vector_k=[], bm25=0, embedded=[], hyde=[])

    class FakeDb:
        def vectors_by_content(self):
            return VECTORS

        def search_by_vector(self, embedding, limit):
            calls.vector_k.append(limit)
            assert list(embedding) == [1.0, 0.0]
            ranked = sorted(DOCUMENTS, key=lambda content: -SIMILARITY[content])
            return [SimpleNamespace(page_content=content) for content in ranked[:limit]]

    class FakeEmbeddings:
        def embed_query(self, text):
            calls.embedded.append(("query", text))
            return [2.0, 0.0]  # not norm 1 on purpose: the pipeline must normalize

        def embed_documents(self, texts):
            calls.embedded.append(("document", texts[0]))
            return [[2.0, 0.0]]

    def fake_hyde(question, cfg, generator):
        calls.hyde.append(question)
        return "Braces stay on for 12 to 36 months."

    calls.deps = RagDeps(
        vector_store_provider=lambda strategy: FakeDb(),
        embeddings=FakeEmbeddings(),
        generator=UNUSED_GENERATOR,
        lexical=LexicalIndex(FakeChunkSource(DOCUMENTS, calls)),
    )
    monkeypatch.setattr(pipeline, "hypothetical_answer", fake_hyde)
    return calls


# --- tokenizing ---

def test_tokenize_removes_punctuation_stopwords_and_plural():
    assert tokenize("How much does Whitening cost?") == ["much", "whitening", "cost"]
    assert tokenize("How many sessions are needed for the veneers?") == ["many", "session", "needed", "veneer"]


def test_tokenize_keeps_words_that_end_in_double_s():
    assert tokenize("painless process, address") == ["painless", "process", "address"]


def test_tokenize_expands_customer_words_into_brochure_words():
    assert tokenize(PRICE_QUESTION, expand=True) == ["much", "price", "whitening", "cost", "price"]
    assert "duration" in tokenize("how long does it take?", expand=True)


@pytest.mark.parametrize(
    "question, brochure_word",
    [
        ("Can you pull a tooth?", "extraction"),
        ("Where are you?", "location"),
        ("Are you open on Saturday?", "hour"),
        ("What's your phone number?", "contact"),
        ("How long does the result last?", "durability"),
        ("How long until I recover?", "recovery"),
        ("I have a cavity", "filling"),
    ],
)
def test_customer_wording_reaches_the_brochure_wording(question, brochure_word):
    assert brochure_word in tokenize(question, expand=True)


def test_documents_are_not_expanded():
    assert tokenize("the cost and the price") == ["cost", "price"]


# --- configuration from the experiment ---

def test_config_from_experiment():
    experiment = Experiment("page_vector", "page", "vector", 3, 0.5, True)

    cfg = RagConfig.from_experiment(experiment, seed=42)

    assert (cfg.experiment, cfg.strategy, cfg.search_type) == ("page_vector", "page", "vector")
    assert (cfg.match_count, cfg.match_threshold, cfg.use_hyde, cfg.seed) == (3, 0.5, True, 42)


@pytest.mark.parametrize(
    "search_type, match_count, expected",
    [
        ("hybrid", 4, (2, 2, 4)),
        ("hybrid", 5, (3, 3, 5)),
        ("hybrid", 1, (1, 1, 1)),
        ("vector", 4, (4, 0, 4)),
        ("bm25", 4, (0, 4, 4)),
    ],
)
def test_search_sizes_come_from_match_count(search_type, match_count, expected):
    cfg = config(search_type, match_count)

    assert (cfg.vector_k, cfg.bm25_k, cfg.final_k) == expected


def test_default_config_uses_the_assistant_experiment():
    from assistant.settings import assistant_experiment

    cfg, experiment = RagConfig(), assistant_experiment()

    assert (cfg.experiment, cfg.strategy) == (experiment.exp_name, experiment.collection)
    assert (cfg.search_type, cfg.match_count) == (experiment.search_type, experiment.match_count)
    assert (cfg.match_threshold, cfg.use_hyde) == (experiment.match_threshold, experiment.use_hyde)


# --- hybrid search and fusion ---

def test_chunk_found_by_both_searches_comes_first(index):
    result = retrieve(PRICE_QUESTION, config(), index.deps)

    assert [chunk.content for chunk in result.vector] == [CLEANING, WHITENING]
    assert result.bm25[0].content == WHITENING
    assert result.fused[0].content == WHITENING
    assert [chunk.rank for chunk in result.fused] == list(range(1, len(result.fused) + 1))


def test_hybrid_fusion_sums_reciprocal_ranks_and_preserves_component_scores(index):
    result = retrieve(PRICE_QUESTION, config(), index.deps)

    whitening = next(chunk for chunk in result.fused if chunk.content == WHITENING)
    cleaning = next(chunk for chunk in result.fused if chunk.content == CLEANING)

    # Whitening appears in both lists (vector rank 2, BM25 rank 1); cleaning appears only in vector.
    assert whitening.score == pytest.approx(1 / 62 + 1 / 61)
    assert cleaning.score == pytest.approx(1 / 61)
    assert next(chunk for chunk in result.vector if chunk.content == CLEANING).score == pytest.approx(0.9)
    assert [chunk.content for chunk in result.bm25] == [WHITENING]
    assert result.bm25[0].score > 0


def test_each_search_contributes_even_when_the_other_misses(index):
    result = retrieve(BRACES_QUESTION, config(), index.deps)

    assert result.bm25[0].content == BRACES
    assert BRACES in [chunk.content for chunk in result.fused]
    assert CLEANING in [chunk.content for chunk in result.fused]


def test_match_count_limits_what_goes_to_the_model(index):
    result = retrieve("braces whitening implants cleaning", config(match_count=3), index.deps)

    assert index.vector_k == [2]
    assert len(result.fused) == 3


def test_lexical_search_drops_chunks_without_any_matching_word(index):
    result = retrieve("xyzabc", config(), index.deps)

    assert result.bm25 == []
    assert [chunk.content for chunk in result.fused] == [CLEANING, WHITENING]


# --- similarity ---

def test_every_chunk_has_the_cosine_similarity_to_the_search_vector(index):
    result = retrieve(BRACES_QUESTION, config(), index.deps)

    for chunks in (result.vector, result.bm25, result.fused):
        assert chunks
        for chunk in chunks:
            assert chunk.similarity == pytest.approx(SIMILARITY[chunk.content])


def test_chunk_found_only_by_words_also_has_similarity(index):
    result = retrieve(BRACES_QUESTION, config(), index.deps)

    braces = next(chunk for chunk in result.fused if chunk.content == BRACES)
    assert BRACES not in [chunk.content for chunk in result.vector]
    assert braces.similarity == pytest.approx(0.3)


def test_question_is_embedded_once(index):
    retrieve(PRICE_QUESTION, config(), index.deps)

    assert index.embedded == [("query", PRICE_QUESTION)]


def test_retrieve_uses_an_injected_vector_store_provider(index):
    calls = []

    class FakeStore:
        def search_by_vector(self, vector, limit):
            calls.append(("search", vector, limit))
            return [SimpleNamespace(page_content=CLEANING)]

        def vectors_by_content(self):
            calls.append(("vectors",))
            return VECTORS

    def provider(strategy):
        calls.append(("provider", strategy))
        return FakeStore()

    result = retrieve(BRACES_QUESTION, config("vector", 1), RagDeps(
        vector_store_provider=provider, embeddings=index.deps.embeddings,
        generator=UNUSED_GENERATOR, lexical=index.deps.lexical,
    ))

    assert [chunk.content for chunk in result.vector] == [CLEANING]
    assert calls == [("provider", "fake"), ("vectors",), ("search", [1.0, 0.0], 1)]


# --- search types ---

def test_vector_search_does_not_use_words(index):
    result = retrieve(BRACES_QUESTION, config("vector", 3), index.deps)

    assert index.bm25 == 0 and index.vector_k == [3]
    assert result.bm25 == []
    assert [chunk.content for chunk in result.fused] == [CLEANING, WHITENING, IMPLANTS]


def test_word_search_does_not_use_the_vector_index_but_has_similarity(index):
    result = retrieve(BRACES_QUESTION, config("bm25", 2), index.deps)

    assert index.vector_k == []
    assert result.vector == []
    assert result.fused[0].content == BRACES
    assert result.fused[0].similarity == pytest.approx(0.3)


# --- threshold ---

def test_threshold_zero_keeps_everything(index):
    assert len(retrieve(BRACES_QUESTION, config(), index.deps).fused) == 4


def test_threshold_drops_chunks_below_and_keeps_the_ones_equal(index):
    result = retrieve(BRACES_QUESTION, config(match_threshold=0.8), index.deps)

    assert [chunk.content for chunk in result.fused] == [CLEANING, WHITENING]
    assert [chunk.rank for chunk in result.fused] == [1, 2]
    assert BRACES in [chunk.content for chunk in result.bm25]  # the cut applies only to what goes to the model


def test_threshold_above_every_similarity_returns_nothing(index):
    assert retrieve(PRICE_QUESTION, config(match_threshold=0.95), index.deps).fused == []


# --- HyDE ---

def test_hyde_searches_with_the_hypothetical_answer_and_words_with_the_question(index):
    result = retrieve(BRACES_QUESTION, config(use_hyde=True), index.deps)

    assert index.hyde == [BRACES_QUESTION]
    assert index.embedded == [("document", "Braces stay on for 12 to 36 months.")]
    assert result.bm25[0].content == BRACES


def test_without_hyde_the_generation_model_is_not_called(index):
    retrieve(BRACES_QUESTION, config(), index.deps)

    assert index.hyde == []


# --- prompt ---

def chunks(*contents):
    return SimpleNamespace(fused=[SimpleNamespace(content=content, rank=rank) for rank, content in enumerate(contents, 1)])


def test_prompt_has_rules_in_system_and_brochure_before_the_question():
    system, human = build_prompt("How much is a cleaning?", chunks(CLEANING, IMPLANTS), config()).to_messages()

    assert system.type == "system" and human.type == "human"
    assert NO_ANSWER in system.content
    assert "DentalSafe" in system.content
    assert "{" not in system.content
    assert human.content.index(CLEANING) < human.content.index("---") < human.content.index(IMPLANTS)
    assert human.content.rstrip().endswith("How much is a cleaning?")


def test_prompt_without_chunks_says_there_is_no_information():
    _, human = build_prompt("How much is a cleaning?", chunks(), config()).to_messages()

    assert NO_INFORMATION in human.content
    assert human.content.rstrip().endswith("How much is a cleaning?")


CONVERSATION = [
    {"role": "user", "content": "Do you offer a cleaning?"},
    {"role": "assistant", "content": "Yes, we do!\n\nIt takes 30–50 minutes."},
]


def test_prompt_brings_the_conversation_before_the_question():
    _, human = build_prompt("how much does it cost?", chunks(CLEANING), config(), CONVERSATION).to_messages()

    assert "Customer: Do you offer a cleaning?\nAssistant: Yes, we do! It takes 30–50 minutes." in human.content
    assert human.content.index("Do you offer a cleaning?") < human.content.index("how much does it cost?")
    assert human.content.rstrip().endswith("how much does it cost?")


def test_prompt_without_conversation_says_it_is_the_first_message():
    _, human = build_prompt("How much is a cleaning?", chunks(CLEANING), config()).to_messages()

    assert NO_CONVERSATION in human.content


class FakeModel:
    def __init__(self, reply):
        self.reply, self.prompts = reply, []

    def generate(self, prompt, *, model, temperature, seed, max_tokens):
        self.prompts.append(prompt)
        return self.reply


def test_follow_up_is_rewritten_with_the_conversation():
    model = FakeModel('"How much does a dental cleaning cost?"')
    generator = model

    assert standalone_question("how much does it cost?", CONVERSATION, config(), generator) == "How much does a dental cleaning cost?"
    assert "Do you offer a cleaning?" in model.prompts[0]


def test_question_without_conversation_is_not_rewritten():
    model = FakeModel("anything")
    generator = model

    assert standalone_question("How much is a cleaning?", [], config(), generator) == "How much is a cleaning?"
    assert model.prompts == []


def test_refusal_phrase_is_recognized_by_the_evaluation():
    from evaluation.answer_metrics import detect_abstention

    assert detect_abstention(NO_ANSWER)


def test_original_prompt_is_a_single_message_with_the_question_before_the_context():
    from dataclasses import replace

    baseline = replace(config(), prompt="original")
    messages = build_prompt("How much is a cleaning?", chunks(CLEANING, IMPLANTS), baseline).to_messages()

    assert len(messages) == 1 and messages[0].type == "human"
    text = messages[0].content
    assert text.index("How much is a cleaning?") < text.index(CLEANING) < text.index("----") < text.index(IMPLANTS)
    assert NO_ANSWER not in text  # the original prompt had no fixed sentence for what the brochure does not say


def test_runs_with_different_prompts_have_different_prompt_texts():
    from dataclasses import replace

    assert pipeline.prompt_text(config()) != pipeline.prompt_text(replace(config(), prompt="original"))


def test_notes_the_model_adds_about_its_own_answer_are_removed():
    from assistant.retrieval.pipeline import clean_answer

    leaked = "Yes, we do! It costs $40–$85.\n\n---\n\n(Note: I didn't invite the customer to schedule.)"
    assert clean_answer(leaked) == "Yes, we do! It costs $40–$85."
    assert clean_answer("Yes, we do!\n\nNote: bring your ID.") == "Yes, we do!"
    assert clean_answer("Yes, we do!\n\nIt costs $40–$85.") == "Yes, we do!\n\nIt costs $40–$85."


def test_greeting_is_removed_only_in_an_ongoing_conversation():
    from assistant.retrieval.pipeline import clean_answer

    assert clean_answer("Hi!\n\nYes, this is DentalSafe.", CONVERSATION) == "Yes, this is DentalSafe."
    assert clean_answer("Hello there, we are open on Saturdays.", CONVERSATION) == "We are open on Saturdays."
    assert clean_answer("Hi!", CONVERSATION) == "Hi!"  # nothing else to say: the greeting stays
    assert clean_answer("Hi! How can I help?") == "Hi! How can I help?"  # first message
    assert clean_answer("Highly recommended.", CONVERSATION) == "Highly recommended."


# --- injected embeddings and the dimension check ---

class RecordingEmbeddings:
    def __init__(self):
        self.queries = []

    def embed_query(self, text):
        self.queries.append(text)
        return [2.0, 0.0]

    def embed_documents(self, texts):
        return [[2.0, 0.0] for _ in texts]


class TwoDimensionalStore:
    def vectors_by_content(self):
        return VECTORS

    def search_by_vector(self, vector, limit):
        return [SimpleNamespace(page_content=CLEANING)]


def test_retrieve_embeds_with_the_injected_embeddings(monkeypatch):
    embeddings = RecordingEmbeddings()

    result = pipeline.retrieve(BRACES_QUESTION, config("vector", 1), RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=embeddings, generator=UNUSED_GENERATOR, lexical=LEXICAL))

    assert embeddings.queries == [BRACES_QUESTION]
    assert [chunk.content for chunk in result.vector] == [CLEANING]


def test_retrieve_requires_the_embeddings():
    with pytest.raises(TypeError):
        pipeline.retrieve(BRACES_QUESTION, config(), RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), generator=UNUSED_GENERATOR))


def test_query_of_another_size_than_the_index_is_refused_with_the_rebuild_command():
    from assistant.index import EmbeddingMismatch

    class ThreeDimensionalStore:
        def vectors_by_content(self):
            return {CLEANING: [1.0, 0.0, 0.0]}

        def search_by_vector(self, vector, limit):
            pytest.fail("the search must not run with incompatible vectors")

    with pytest.raises(EmbeddingMismatch) as info:
        pipeline.retrieve(BRACES_QUESTION, config("vector", 1), RagDeps(vector_store_provider=lambda strategy: ThreeDimensionalStore(), embeddings=RecordingEmbeddings(), generator=UNUSED_GENERATOR, lexical=LEXICAL))

    assert str(info.value) == (
        'the embedding model returned 2 dimensions but the index of strategy "fake" has 3; '
        "run: python -m assistant.ingest fake"
    )


# --- text generation: the parameters of each call, and the generator the caller provides ---

class FakeGenerator:
    """Records each call and answers with the scripted replies; stream yields the scripted pieces."""

    def __init__(self, *replies, pieces=()):
        self.replies = list(replies)
        self.pieces = list(pieces)
        self.calls = []

    def generate(self, prompt, *, model, temperature, seed, max_tokens):
        self.calls.append(dict(method="generate", prompt=prompt, model=model, temperature=temperature, seed=seed, max_tokens=max_tokens))
        return self.replies.pop(0)

    def stream(self, prompt, *, model, temperature, seed, max_tokens):
        self.calls.append(dict(method="stream", prompt=prompt, model=model, temperature=temperature, seed=seed, max_tokens=max_tokens))
        yield from self.pieces


def test_hyde_asks_the_model_for_a_short_text_with_fixed_settings():
    from dataclasses import replace

    from assistant.generation.prompting import HYDE_MAX_TOKENS, HYDE_PROMPT

    generator = FakeGenerator("  Braces stay on for 12 to 36 months.  ")
    cfg = replace(config(use_hyde=True), chat_model="llama3.1", seed=7)

    text = pipeline.hypothetical_answer(BRACES_QUESTION, cfg, generator)

    assert text == "Braces stay on for 12 to 36 months."
    assert generator.calls == [{
        "method": "generate", "prompt": HYDE_PROMPT.format(ask=BRACES_QUESTION), "model": "llama3.1",
        "temperature": 0.0, "seed": 7, "max_tokens": HYDE_MAX_TOKENS,
    }]


def test_rewrite_asks_the_model_with_fixed_settings_and_the_conversation():
    from dataclasses import replace

    from assistant.generation.prompting import STANDALONE_MAX_TOKENS

    generator = FakeGenerator('"How much does a dental cleaning cost?"')
    cfg = replace(config(), chat_model="llama3.1", seed=7)

    rewritten = standalone_question("how much does it cost?", CONVERSATION, cfg, generator)

    assert rewritten == "How much does a dental cleaning cost?"
    call = generator.calls[0]
    assert (call["model"], call["temperature"], call["seed"], call["max_tokens"]) == ("llama3.1", 0.0, 7, STANDALONE_MAX_TOKENS)
    assert "Do you offer a cleaning?" in call["prompt"]


def test_answer_asks_the_model_with_the_configured_settings_and_cleans_the_reply():
    from dataclasses import replace

    generator = FakeGenerator("Braces cost $180–$450.\n\nNote: bring your ID.")
    cfg = replace(config("vector", 1), chat_model="llama3.1", temperature=0.3, seed=11, max_answer_tokens=99)

    result = pipeline.answer(BRACES_QUESTION, cfg, None, RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=RecordingEmbeddings(), generator=generator, lexical=LEXICAL))

    assert result.answer == "Braces cost $180–$450."
    assert [(c["model"], c["temperature"], c["seed"], c["max_tokens"]) for c in generator.calls] == [
        ("llama3.1", 0.3, 11, 99),
    ]


def test_streaming_asks_the_model_with_the_configured_settings_and_yields_the_pieces():
    from dataclasses import replace

    generator = FakeGenerator(pieces=["Braces ", "cost $180."])
    cfg = replace(config("vector", 1), chat_model="llama3.1", temperature=0.3, seed=11, max_answer_tokens=99)

    pieces = list(pipeline.stream_answer(BRACES_QUESTION, cfg, RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=RecordingEmbeddings(), generator=generator, lexical=LEXICAL)))

    assert pieces == ["Braces ", "cost $180."]
    assert [(c["model"], c["temperature"], c["seed"], c["max_tokens"]) for c in generator.calls] == [
        ("llama3.1", 0.3, 11, 99),
    ]


def test_streaming_does_not_clean_the_pieces_as_the_plain_answer_is_cleaned():
    # Characterization: the plain answer drops the model's notes; the stream passes the text through unchanged.
    generator = FakeGenerator(pieces=["Yes, we do!\n\nNote: bring your ID."])

    pieces = list(pipeline.stream_answer(BRACES_QUESTION, config("vector", 1), RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=RecordingEmbeddings(), generator=generator, lexical=LEXICAL)))

    assert pieces == ["Yes, we do!\n\nNote: bring your ID."]


def test_retrieval_without_hyde_does_not_call_the_generator():
    generator = FakeGenerator()

    pipeline.retrieve(BRACES_QUESTION, config("vector", 1), RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=RecordingEmbeddings(), generator=generator, lexical=LEXICAL))

    assert generator.calls == []


def test_empty_index_is_not_compared_with_the_query():
    class EmptyStore:
        def vectors_by_content(self):
            return {}

        def search_by_vector(self, vector, limit):
            return []

    result = pipeline.retrieve(BRACES_QUESTION, config("vector", 1), RagDeps(vector_store_provider=lambda strategy: EmptyStore(), embeddings=RecordingEmbeddings(), generator=UNUSED_GENERATOR, lexical=LEXICAL))

    assert result.vector == []


# --- the words and the vectors of one index must describe the same chunks ---

def test_a_chunk_of_the_words_index_missing_from_the_vector_store_is_refused_with_the_rebuild_command():
    class PartialStore:
        def vectors_by_content(self):
            return {CLEANING: VECTORS[CLEANING]}

        def search_by_vector(self, vector, limit):
            return [SimpleNamespace(page_content=CLEANING)]

    with pytest.raises(IndexInconsistent) as info:
        pipeline.retrieve(BRACES_QUESTION, config(), RagDeps(vector_store_provider=lambda strategy: PartialStore(), embeddings=RecordingEmbeddings(), generator=UNUSED_GENERATOR, lexical=LEXICAL))

    assert str(info.value) == (
        'the index of strategy "fake" is inconsistent: chunks.json holds 3 chunk(s) the vector store does not; '
        "run: python -m assistant.ingest fake"
    )


def test_the_consistency_check_runs_only_when_the_words_are_searched():
    class PartialStore:
        def vectors_by_content(self):
            return {CLEANING: VECTORS[CLEANING]}

        def search_by_vector(self, vector, limit):
            return [SimpleNamespace(page_content=CLEANING)]

    result = pipeline.retrieve(BRACES_QUESTION, config("vector", 1), RagDeps(vector_store_provider=lambda strategy: PartialStore(), embeddings=RecordingEmbeddings(), generator=UNUSED_GENERATOR, lexical=LEXICAL))

    assert [chunk.content for chunk in result.vector] == [CLEANING]


# --- the dependencies of the pipeline: all four are required, none has a default ---

def test_the_dependencies_have_no_defaults():
    with pytest.raises(TypeError):
        RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=RecordingEmbeddings(),
                generator=UNUSED_GENERATOR)  # no lexical index
    with pytest.raises(TypeError):
        RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), generator=UNUSED_GENERATOR,
                lexical=LEXICAL)  # no embeddings


def test_hyde_is_asked_of_the_generator_in_the_dependencies():
    generator = FakeGenerator("Braces stay on for 12 to 36 months.")
    deps = RagDeps(vector_store_provider=lambda strategy: TwoDimensionalStore(), embeddings=RecordingEmbeddings(),
                   generator=generator, lexical=LEXICAL)

    pipeline.retrieve(BRACES_QUESTION, config("vector", 1, use_hyde=True), deps)

    assert [call["method"] for call in generator.calls] == ["generate"]
