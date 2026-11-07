"""Opções lexicais na configuração: o experimento escolhe, a configuração lê, o histórico registra só quando difere do padrão."""
import numpy as np
import pytest

from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.generation.prompting import prompt_text
from assistant.retrieval.lexical import LexicalIndex
from assistant.retrieval.lexical_options import LexicalOptions
from assistant.retrieval.pipeline import RagConfig, RagDeps, retrieve
from assistant.settings import Experiment, SettingsError, assistant_experiment, experiments, parse_settings
from evaluation.compare import compare
from evaluation.history import lexical_entry

SOURCE = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR)
DOCS = [
    "Dental Cleaning Duration 30 minutes Price 40 to 85 dollars",
    "Teeth Whitening remove stains from coffee price 180 to 450",
    "Braces traditional braces or clear aligners duration 12 to 36 months",
    "Dental implants a titanium post duration 3 to 6 months",
]
STRATEGIES = "strategies:\n  - name: section\n    type: section\n"
LEX_VARIANTS = {
    "lex_base": {},
    "lex_no_synonyms": {"synonyms": "none"},
    "lex_generic_synonyms": {"synonyms": "generic"},
    "lex_stopwordsiso": {"stopwords": "stopwordsiso"},
    "lex_snowball": {"stemmer": "snowball"},
    "lex_snowball_stopwordsiso": {"stemmer": "snowball", "stopwords": "stopwordsiso"},
    "lex_snowball_no_synonyms": {"stemmer": "snowball", "synonyms": "none"},
    "lex_snowball_stopwordsiso_no_synonyms": {"stopwords": "stopwordsiso", "stemmer": "snowball", "synonyms": "none"},
}


def experiments_yaml(extra=""):
    return (
        "assistant: section_hybrid\n"
        "experiments:\n"
        "  - exp_name: section_hybrid\n"
        "    collection: section\n"
        "    search_type: hybrid\n"
        "    match_count: 4\n"
        + extra
    )


def config(lexical=LexicalOptions()):
    return RagConfig(experiment="test", strategy="section", search_type="hybrid", match_count=4,
                     match_threshold=0.0, use_hyde=False, prompt="rules", lexical=lexical)


# --- the lexicon keeps the language words apart ---

def test_the_language_synonyms_are_kept_apart_from_the_merged_ones():
    import yaml

    lexicon = SOURCE.load().lexicon
    pack = yaml.safe_load((LANGUAGES_DIR / "en.yaml").read_text(encoding="utf-8"))

    assert lexicon.language == "en"
    assert lexicon.generic_synonyms == {word: tuple(words) for word, words in pack["query_synonyms"].items()}
    assert "whiten" in lexicon.synonyms and "whiten" not in lexicon.generic_synonyms


# --- the experiment file ---

def test_the_lexical_options_are_read_from_the_experiment():
    text = experiments_yaml("    lexical:\n      stemmer: snowball\n      synonyms: none\n")

    settings = parse_settings(STRATEGIES, text)

    assert settings.experiments["section_hybrid"].lexical == LexicalOptions(stemmer="snowball", synonyms="none")


def test_an_experiment_without_lexical_options_has_the_defaults():
    assert parse_settings(STRATEGIES, experiments_yaml()).experiments["section_hybrid"].lexical == LexicalOptions()


def test_an_invalid_lexical_value_is_refused_with_the_values_allowed():
    with pytest.raises(SettingsError) as error:
        parse_settings(STRATEGIES, experiments_yaml("    lexical:\n      stemmer: porter\n"))

    assert 'stemmer "porter" does not exist; use one of: plural, none, snowball' in str(error.value)
    assert "section_hybrid" in str(error.value)


def test_an_unknown_lexical_key_is_refused():
    with pytest.raises(SettingsError) as error:
        parse_settings(STRATEGIES, experiments_yaml("    lexical:\n      lemma: yes\n"))

    assert "unknown field: lemma" in str(error.value)


def test_the_config_has_the_lexical_variants_on_the_assistant_search():
    lexical = {experiment.exp_name: experiment for experiment in experiments() if experiment.exp_name.startswith("lex_")}

    assert set(lexical) == set(LEX_VARIANTS)
    for name, experiment in lexical.items():
        assert (experiment.collection, experiment.search_type, experiment.match_count) == ("section", "hybrid", 4), name
        assert experiment.lexical == LexicalOptions(**LEX_VARIANTS[name]), name


def test_the_assistant_uses_the_libraries_and_no_synonyms():
    assert assistant_experiment().lexical == LexicalOptions(stopwords="stopwordsiso", stemmer="snowball", synonyms="none")


# --- the configuration ---

def test_the_configuration_takes_the_lexical_options_of_the_experiment():
    experiment = Experiment("lex_test", "section", "hybrid", 4, lexical=LexicalOptions(synonyms="none"))

    assert RagConfig.from_experiment(experiment).lexical == LexicalOptions(synonyms="none")
    assert RagConfig().lexical == assistant_experiment().lexical


class Chunks:
    def version(self, strategy):
        return "v1"

    def chunks(self, strategy):
        return list(DOCS)


class OneDimensionStore:
    def vectors_by_content(self):
        return {document: np.array([1.0, 0.0]) for document in DOCS}

    def search_by_vector(self, vector, limit):
        pytest.fail("the word search alone must not use the vector store")


class Embeddings:
    def embed_query(self, text):
        return [1.0, 0.0]

    def embed_documents(self, texts):
        return [[1.0, 0.0] for _ in texts]


class RecordingLexical:
    def __init__(self, inner):
        self.inner, self.asked = inner, []

    def get(self, strategy, options):
        self.asked.append(options)
        return self.inner.get(strategy, options)


def test_retrieve_hands_the_options_to_the_index_and_to_the_question():
    from dataclasses import replace

    options = LexicalOptions(synonyms="none")
    lexical = RecordingLexical(LexicalIndex(Chunks(), SOURCE))
    deps = RagDeps(vector_store_provider=lambda strategy: OneDimensionStore(), embeddings=Embeddings(),
                   generator=None, lexical=lexical, clinic=SOURCE)

    result = retrieve("How much does Whitening cost?", replace(config(), search_type="bm25", lexical=options), deps)

    assert lexical.asked == [options]
    assert result.bm25[0].content == DOCS[1]


# --- the history and the prompt ---

def test_lexical_options_are_saved_only_when_they_differ_from_the_defaults():
    assert lexical_entry(config()) == {}
    assert lexical_entry(config(LexicalOptions(stemmer="snowball"))) == {
        "lexical": {"stopwords": "profile", "stemmer": "snowball", "synonyms": "profile"},
    }


def test_the_lexical_options_do_not_change_the_prompt_text():
    clinic = SOURCE.load()

    assert prompt_text(config(), clinic) == prompt_text(config(LexicalOptions(synonyms="none")), clinic)


def test_compare_reports_the_lexical_options_against_a_run_saved_with_the_defaults(make_run, make_result):
    result = make_result("cleaning-price-01")
    base = make_run("base", [result])
    candidate = make_run("candidate", [result], lexical={"stopwords": "profile", "stemmer": "snowball", "synonyms": "profile"})

    changes = compare(base, candidate)["config_changes"]

    assert changes == {"lexical": {
        "base": {"stopwords": "profile", "stemmer": "plural", "synonyms": "profile"},
        "candidate": {"stopwords": "profile", "stemmer": "snowball", "synonyms": "profile"},
    }}
