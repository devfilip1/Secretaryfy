import pytest

from assistant.retrieval.lexical import LexicalIndex, tokenize
from assistant.retrieval.pipeline import tokenize as pipeline_tokenize

DOCS = [
    "Dental Cleaning Duration 30 minutes Price 40 to 85 dollars",
    "Teeth Whitening remove stains from coffee price 180 to 450",
    "Braces traditional braces or clear aligners duration 12 to 36 months",
    "Dental implants a titanium post duration 3 to 6 months",
]


class FakeChunkSource:
    """Chunks and versions that the test changes; counts how many times the texts were read."""

    def __init__(self, texts, version="v1"):
        self.texts = list(texts)
        self.versions = {"section": version}
        self.reads = 0

    def version(self, strategy):
        return self.versions.get(strategy)

    def chunks(self, strategy):
        self.reads += 1
        return list(self.texts)


def test_tokenize_is_the_same_function_the_pipeline_exports():
    assert pipeline_tokenize is tokenize


def test_scores_are_the_ones_the_bm25_of_the_pipeline_gave():
    # Characterization, recorded from the BM25 that the pipeline built before the lexical index existed.
    bm25, documents = LexicalIndex(FakeChunkSource(DOCS)).get("section")

    assert documents == DOCS
    expected = {
        "How much does whitening cost?": [0.0, 0.8703361708, 0.0, 0.0],
        "how long do braces take": [0.3390231922, 0.0, 1.5269872026, 0.3574594987],
        "xyzabc": [0.0, 0.0, 0.0, 0.0],
        "Can you pull a tooth?": [0.0, 0.8703361708, 0.0, 0.0],
    }
    for question, scores in expected.items():
        assert list(bm25.get_scores(tokenize(question, expand=True))) == pytest.approx(scores)


def test_the_index_is_reused_while_the_version_does_not_change():
    source = FakeChunkSource(DOCS)
    lexical = LexicalIndex(source)

    first = lexical.get("section")
    second = lexical.get("section")

    assert second[0] is first[0]
    assert source.reads == 1


def test_the_index_is_rebuilt_when_the_version_changes():
    source = FakeChunkSource(DOCS)
    lexical = LexicalIndex(source)
    lexical.get("section")

    source.texts = ["Braces stay on for 12 to 36 months", "Implants take 3 to 6 months", "Cleaning costs 40 dollars"]
    source.versions["section"] = "v2"
    bm25, documents = lexical.get("section")

    assert documents == source.texts
    assert source.reads == 2
    assert bm25.get_scores(tokenize("braces"))[0] > 0


def test_each_strategy_keeps_its_own_index():
    source = FakeChunkSource(DOCS)
    source.versions["page"] = "p1"
    lexical = LexicalIndex(source)

    lexical.get("section")
    lexical.get("page")
    lexical.get("section")

    assert source.reads == 2


def test_documents_come_back_in_the_order_of_the_source():
    _, documents = LexicalIndex(FakeChunkSource(DOCS)).get("section")

    assert documents == DOCS


def test_default_lexical_index_is_one_instance_per_process_and_reset_builds_a_new_one():
    from assistant.storage import factory

    factory.reset_default_lexical_index()
    factory.reset_default_chunk_source()
    try:
        first = factory.default_lexical_index()

        assert first is factory.default_lexical_index()
        assert isinstance(first, LexicalIndex)
        factory.reset_default_lexical_index()
        assert factory.default_lexical_index() is not first
    finally:
        factory.reset_default_lexical_index()
        factory.reset_default_chunk_source()


def test_default_chunk_source_is_one_instance_per_process_and_reset_builds_a_new_one():
    from assistant.storage import factory

    factory.reset_default_chunk_source()
    try:
        first = factory.default_chunk_source()

        assert first is factory.default_chunk_source()
        factory.reset_default_chunk_source()
        assert factory.default_chunk_source() is not first
    finally:
        factory.reset_default_chunk_source()
