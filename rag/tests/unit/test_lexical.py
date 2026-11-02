from types import SimpleNamespace

import pytest

from assistant.clinic.profile import Lexicon
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.retrieval import lexical
from assistant.retrieval.lexical import LexicalIndex, tokenize
from assistant.retrieval.lexical_options import LexicalOptions
from assistant.retrieval.pipeline import tokenize as pipeline_tokenize

CLINIC = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR)

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


class FakeClinic:
    """A clinic profile source whose version the test changes; counts the times the profile was read."""

    def __init__(self, lexicon):
        self.lexicon, self.version_value, self.loads = lexicon, "c1", 0

    def version(self):
        return self.version_value

    def load(self):
        self.loads += 1
        return SimpleNamespace(lexicon=self.lexicon)


def test_tokenize_is_the_same_function_the_pipeline_exports():
    assert pipeline_tokenize is tokenize


def test_tokenize_uses_the_lexicon_it_is_given():
    lexicon = Lexicon(stopwords=frozenset({"braces"}), synonyms={"fix": ("braces",)})

    assert tokenize("braces fix teeth", lexicon) == ["fix", "teeth"]
    assert tokenize("braces fix teeth", lexicon, expand=True) == ["fix", "brace", "teeth"]  # the plural rule applies to the synonyms too


def test_scores_are_the_ones_the_bm25_of_the_pipeline_gave():
    # Characterization, recorded from the BM25 that the pipeline built before the lexical index existed.
    bm25, documents = LexicalIndex(FakeChunkSource(DOCS), CLINIC).get("section")

    assert documents == DOCS
    expected = {
        "How much does whitening cost?": [0.0, 0.8703361708, 0.0, 0.0],
        "how long do braces take": [0.3390231922, 0.0, 1.5269872026, 0.3574594987],
        "xyzabc": [0.0, 0.0, 0.0, 0.0],
        "Can you pull a tooth?": [0.0, 0.8703361708, 0.0, 0.0],
    }
    lexicon = CLINIC.load().lexicon
    for question, scores in expected.items():
        assert list(bm25.get_scores(tokenize(question, lexicon, expand=True))) == pytest.approx(scores)


def test_the_index_is_reused_while_the_version_does_not_change():
    source = FakeChunkSource(DOCS)
    lexical_index = LexicalIndex(source, CLINIC)

    first = lexical_index.get("section")
    second = lexical_index.get("section")

    assert second[0] is first[0]
    assert source.reads == 1


def test_the_index_is_rebuilt_when_the_version_changes():
    source = FakeChunkSource(DOCS)
    lexical_index = LexicalIndex(source, CLINIC)
    lexical_index.get("section")

    source.texts = ["Braces stay on for 12 to 36 months", "Implants take 3 to 6 months", "Cleaning costs 40 dollars"]
    source.versions["section"] = "v2"
    bm25, documents = lexical_index.get("section")

    assert documents == source.texts
    assert source.reads == 2
    assert bm25.get_scores(tokenize("braces", CLINIC.load().lexicon))[0] > 0


def test_the_index_is_rebuilt_only_when_the_clinic_version_changes(monkeypatch):
    builds, words = [], []
    real_bm25, real_tokenize = lexical.BM25Okapi, lexical.tokenize

    def counting_bm25(corpus):
        builds.append(corpus)
        return real_bm25(corpus)

    def counting_tokenize(text, lexicon, expand=False, **options):
        words.append(text)
        return real_tokenize(text, lexicon, expand, **options)

    monkeypatch.setattr(lexical, "BM25Okapi", counting_bm25)
    monkeypatch.setattr(lexical, "tokenize", counting_tokenize)
    source, clinic = FakeChunkSource(DOCS), FakeClinic(CLINIC.load().lexicon)
    lexical_index = LexicalIndex(source, clinic)

    lexical_index.get("section")
    lexical_index.get("section")
    assert (len(builds), source.reads, clinic.loads) == (1, 1, 1)
    assert len(words) == len(DOCS)

    clinic.version_value = "c2"
    lexical_index.get("section")
    assert (len(builds), source.reads, clinic.loads) == (2, 2, 2)
    assert len(words) == 2 * len(DOCS)


def test_the_rebuilt_index_uses_the_lexicon_of_the_new_clinic_version():
    clinic = FakeClinic(CLINIC.load().lexicon)
    lexical_index = LexicalIndex(FakeChunkSource(DOCS), clinic)
    bm25, _ = lexical_index.get("section")
    assert bm25.get_scores(["brace"])[2] > 0

    clinic.lexicon = Lexicon(stopwords=frozenset({"braces"}), synonyms={})
    clinic.version_value = "c2"
    bm25, _ = lexical_index.get("section")

    assert list(bm25.get_scores(["brace"])) == [0.0, 0.0, 0.0, 0.0]


def test_each_strategy_keeps_its_own_index():
    source = FakeChunkSource(DOCS)
    source.versions["page"] = "p1"
    lexical_index = LexicalIndex(source, CLINIC)

    lexical_index.get("section")
    lexical_index.get("page")
    lexical_index.get("section")

    assert source.reads == 2


def test_documents_come_back_in_the_order_of_the_source():
    _, documents = LexicalIndex(FakeChunkSource(DOCS), CLINIC).get("section")

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


def test_the_process_lexical_index_and_the_composition_share_one_clinic_profile():
    from assistant import composition
    from assistant.storage import factory

    factory.reset_default_lexical_index()
    factory.reset_default_chunk_source()
    factory.reset_default_clinic_profile()
    try:
        profile = factory.default_clinic_profile()

        assert composition.build_clinic_provider() is profile
        assert factory.default_lexical_index()._clinic is profile
    finally:
        factory.reset_default_lexical_index()
        factory.reset_default_chunk_source()
        factory.reset_default_clinic_profile()


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


# --- one index per strategy and per set of options ---

def test_each_options_set_keeps_its_own_index_and_only_the_asked_one_is_rebuilt():
    source = FakeChunkSource(DOCS)
    lexical_index = LexicalIndex(source, CLINIC)
    no_stemmer = LexicalOptions(stemmer="none")

    lexical_index.get("section")
    lexical_index.get("section", no_stemmer)
    lexical_index.get("section")
    lexical_index.get("section", no_stemmer)
    assert source.reads == 2

    source.versions["section"] = "v2"
    lexical_index.get("section", no_stemmer)
    assert source.reads == 3  # the default index is rebuilt only when it is asked for


def test_each_options_set_scores_with_its_own_tokens():
    lexical_index = LexicalIndex(FakeChunkSource(DOCS), CLINIC)
    no_stemmer = LexicalOptions(stemmer="none")

    # DOCS[0] says "30 minutes": the default index stores "minute", the variant keeps "minutes"
    assert lexical_index.get("section")[0].get_scores(["minute"])[0] > 0
    assert lexical_index.get("section", no_stemmer)[0].get_scores(["minute"])[0] == 0
