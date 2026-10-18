from types import SimpleNamespace

import numpy as np
import pytest
from rank_bm25 import BM25Okapi

from assistant import pipeline
from assistant.pipeline import NO_ANSWER, NO_INFORMATION, RagConfig, build_prompt, retrieve, tokenize
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


@pytest.fixture
def index(monkeypatch):
    """In-memory index. Records what was asked of each search and of the models."""
    calls = SimpleNamespace(vector_k=[], bm25=0, embedded=[], hyde=[])

    class FakeDb:
        def similarity_search_by_vector(self, embedding, k):
            calls.vector_k.append(k)
            assert list(embedding) == [1.0, 0.0]
            ranked = sorted(DOCUMENTS, key=lambda content: -SIMILARITY[content])
            return [SimpleNamespace(page_content=content) for content in ranked[:k]]

    class FakeEmbeddings:
        def embed_query(self, text):
            calls.embedded.append(("query", text))
            return [2.0, 0.0]  # not norm 1 on purpose: the pipeline must normalize

        def embed_documents(self, texts):
            calls.embedded.append(("document", texts[0]))
            return [[2.0, 0.0]]

    def fake_bm25(strategy):
        calls.bm25 += 1
        return BM25Okapi([tokenize(d) for d in DOCUMENTS]), DOCUMENTS

    def fake_hyde(question, cfg):
        calls.hyde.append(question)
        return "Braces stay on for 12 to 36 months."

    monkeypatch.setattr(pipeline, "_db", lambda strategy: FakeDb())
    monkeypatch.setattr(pipeline, "_bm25", fake_bm25)
    monkeypatch.setattr(pipeline, "_vectors", lambda strategy: VECTORS)
    monkeypatch.setattr(pipeline, "EMBEDDINGS", FakeEmbeddings())
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
    result = retrieve(PRICE_QUESTION, config())

    assert [chunk.content for chunk in result.vector] == [CLEANING, WHITENING]
    assert result.bm25[0].content == WHITENING
    assert result.fused[0].content == WHITENING
    assert [chunk.rank for chunk in result.fused] == list(range(1, len(result.fused) + 1))


def test_each_search_contributes_even_when_the_other_misses(index):
    result = retrieve(BRACES_QUESTION, config())

    assert result.bm25[0].content == BRACES
    assert BRACES in [chunk.content for chunk in result.fused]
    assert CLEANING in [chunk.content for chunk in result.fused]


def test_match_count_limits_what_goes_to_the_model(index):
    result = retrieve("braces whitening implants cleaning", config(match_count=3))

    assert index.vector_k == [2]
    assert len(result.fused) == 3


def test_lexical_search_drops_chunks_without_any_matching_word(index):
    result = retrieve("xyzabc", config())

    assert result.bm25 == []
    assert [chunk.content for chunk in result.fused] == [CLEANING, WHITENING]


# --- similarity ---

def test_every_chunk_has_the_cosine_similarity_to_the_search_vector(index):
    result = retrieve(BRACES_QUESTION, config())

    for chunks in (result.vector, result.bm25, result.fused):
        assert chunks
        for chunk in chunks:
            assert chunk.similarity == pytest.approx(SIMILARITY[chunk.content])


def test_chunk_found_only_by_words_also_has_similarity(index):
    result = retrieve(BRACES_QUESTION, config())

    braces = next(chunk for chunk in result.fused if chunk.content == BRACES)
    assert BRACES not in [chunk.content for chunk in result.vector]
    assert braces.similarity == pytest.approx(0.3)


def test_question_is_embedded_once(index):
    retrieve(PRICE_QUESTION, config())

    assert index.embedded == [("query", PRICE_QUESTION)]


# --- search types ---

def test_vector_search_does_not_use_words(index):
    result = retrieve(BRACES_QUESTION, config("vector", 3))

    assert index.bm25 == 0 and index.vector_k == [3]
    assert result.bm25 == []
    assert [chunk.content for chunk in result.fused] == [CLEANING, WHITENING, IMPLANTS]


def test_word_search_does_not_use_the_vector_index_but_has_similarity(index):
    result = retrieve(BRACES_QUESTION, config("bm25", 2))

    assert index.vector_k == []
    assert result.vector == []
    assert result.fused[0].content == BRACES
    assert result.fused[0].similarity == pytest.approx(0.3)


# --- threshold ---

def test_threshold_zero_keeps_everything(index):
    assert len(retrieve(BRACES_QUESTION, config()).fused) == 4


def test_threshold_drops_chunks_below_and_keeps_the_ones_equal(index):
    result = retrieve(BRACES_QUESTION, config(match_threshold=0.8))

    assert [chunk.content for chunk in result.fused] == [CLEANING, WHITENING]
    assert [chunk.rank for chunk in result.fused] == [1, 2]
    assert BRACES in [chunk.content for chunk in result.bm25]  # the cut applies only to what goes to the model


def test_threshold_above_every_similarity_returns_nothing(index):
    assert retrieve(PRICE_QUESTION, config(match_threshold=0.95)).fused == []


# --- HyDE ---

def test_hyde_searches_with_the_hypothetical_answer_and_words_with_the_question(index):
    result = retrieve(BRACES_QUESTION, config(use_hyde=True))

    assert index.hyde == [BRACES_QUESTION]
    assert index.embedded == [("document", "Braces stay on for 12 to 36 months.")]
    assert result.bm25[0].content == BRACES


def test_without_hyde_the_generation_model_is_not_called(index):
    retrieve(BRACES_QUESTION, config())

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
