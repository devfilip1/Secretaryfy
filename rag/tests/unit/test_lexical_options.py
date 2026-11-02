"""Opções lexicais da busca por palavras: os defaults reproduzem o comportamento anterior e cada escolha tem efeito."""
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

from assistant.clinic.profile import Lexicon
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.retrieval import lexical
from assistant.retrieval.lexical import tokenize
from assistant.retrieval.lexical_options import LexicalOptions

GOLDEN = json.loads((Path(__file__).parent / "golden" / "tokens.json").read_text(encoding="utf-8"))
CLINIC = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR).load()
QUESTION = "How much does Whitening cost?"


def test_defaults_are_the_options_the_project_had():
    assert LexicalOptions() == LexicalOptions(stopwords="profile", stemmer="plural", synonyms="profile")


def test_default_options_reproduce_the_golden_tokens():
    for sentence, expected in GOLDEN.items():
        assert tokenize(sentence, CLINIC.lexicon, options=LexicalOptions()) == expected["plain"], sentence
        assert tokenize(sentence, CLINIC.lexicon, expand=True, options=LexicalOptions()) == expected["expanded"], sentence


@pytest.mark.parametrize("field, value", [
    ("stopwords", "nltk"), ("stemmer", "porter"), ("synonyms", "wordnet"), ("stemmer", ""),
])
def test_a_value_outside_the_list_is_refused_and_the_list_is_shown(field, value):
    with pytest.raises(ValueError, match=f'{field} "{value}" does not exist; use one of: '):
        LexicalOptions(**{field: value})


def test_from_mapping_without_the_key_gives_the_defaults():
    assert LexicalOptions.from_mapping(None) == LexicalOptions()
    assert LexicalOptions.from_mapping({"stemmer": "snowball"}) == LexicalOptions(stemmer="snowball")


def test_from_mapping_refuses_unknown_keys_and_other_shapes():
    with pytest.raises(ValueError, match="unknown lexical option: lemma"):
        LexicalOptions.from_mapping({"lemma": "yes"})
    with pytest.raises(ValueError, match="must be a mapping"):
        LexicalOptions.from_mapping(["stemmer"])


def test_options_are_hashable_so_each_variant_is_its_own_cache_key():
    assert len({LexicalOptions(), LexicalOptions(), LexicalOptions(stemmer="snowball")}) == 2


# --- each option changes the tokens, and the default changes nothing ---

def test_no_synonyms_keeps_the_customer_word_only():
    options = LexicalOptions(synonyms="none")

    assert tokenize(QUESTION, CLINIC.lexicon, expand=True, options=options) == ["much", "whitening", "cost"]


def test_generic_synonyms_expand_the_language_words_but_not_the_clinic_ones():
    options = LexicalOptions(synonyms="generic")

    assert tokenize("the cost", CLINIC.lexicon, expand=True, options=options) == ["cost", "price"]
    assert tokenize("whiten", CLINIC.lexicon, expand=True, options=options) == ["whiten"]
    assert tokenize("whiten", CLINIC.lexicon, expand=True) == ["whiten", "whitening"]


def test_no_stopwords_keeps_every_word():
    options = LexicalOptions(stopwords="none")

    assert tokenize(QUESTION, CLINIC.lexicon, options=options) == ["how", "much", "doe", "whitening", "cost"]


def test_stopwordsiso_removes_a_word_the_profile_keeps():
    pytest.importorskip("stopwordsiso")

    assert tokenize(QUESTION, CLINIC.lexicon, options=LexicalOptions(stopwords="stopwordsiso")) == ["whitening", "cost"]


def test_no_stemmer_keeps_the_plural():
    assert tokenize("prices", CLINIC.lexicon, options=LexicalOptions(stemmer="none")) == ["prices"]
    assert tokenize("prices", CLINIC.lexicon) == ["price"]


def test_snowball_joins_the_forms_of_a_word_and_the_default_does_not():
    pytest.importorskip("Stemmer")
    snowball = LexicalOptions(stemmer="snowball")

    assert tokenize("pricing prices priced price", CLINIC.lexicon, options=snowball) == ["price"] * 4
    assert tokenize("pricing prices priced", CLINIC.lexicon) == ["pricing", "price", "priced"]


def test_snowball_stems_the_synonyms_too_as_the_plural_rule_does():
    pytest.importorskip("Stemmer")

    assert tokenize("whiten", CLINIC.lexicon, expand=True, options=LexicalOptions(stemmer="snowball")) == ["whiten", "whiten"]


# --- the libraries: loaded only when asked, with a message that says what to install ---

@pytest.mark.parametrize("options, module, pip_name", [
    (LexicalOptions(stopwords="stopwordsiso"), "stopwordsiso", "stopwordsiso"),
    (LexicalOptions(stemmer="snowball"), "Stemmer", "PyStemmer"),
])
def test_a_missing_library_is_reported_with_the_pip_command(monkeypatch, options, module, pip_name):
    monkeypatch.setitem(sys.modules, module, None)  # makes the import fail
    monkeypatch.setattr(lexical, "_stopwords_by_language", {})

    with pytest.raises(ImportError, match=f"pip install {pip_name}"):
        tokenize("How much", CLINIC.lexicon, options=options)


def test_the_stopword_list_of_a_language_is_read_once(monkeypatch):
    calls = []
    fake = ModuleType("stopwordsiso")
    fake.stopwords = lambda language: calls.append(language) or {"much"}
    monkeypatch.setitem(sys.modules, "stopwordsiso", fake)
    monkeypatch.setattr(lexical, "_stopwords_by_language", {})
    options = LexicalOptions(stopwords="stopwordsiso")

    assert tokenize("much cost", CLINIC.lexicon, options=options) == ["cost"]
    tokenize("much cost", CLINIC.lexicon, options=options)

    assert calls == ["en"]


def test_a_language_without_a_stopword_list_is_refused_by_name():
    pytest.importorskip("stopwordsiso")
    lexicon = Lexicon(stopwords=frozenset(), synonyms={}, language="xx")

    with pytest.raises(ValueError, match='no stopword list for language "xx"'):
        tokenize("text", lexicon, options=LexicalOptions(stopwords="stopwordsiso"))


def test_a_language_without_a_snowball_stemmer_is_refused_by_name():
    pytest.importorskip("Stemmer")
    lexicon = Lexicon(stopwords=frozenset(), synonyms={}, language="xx")

    with pytest.raises(ValueError, match='no stemmer for language "xx"'):
        tokenize("text", lexicon, options=LexicalOptions(stemmer="snowball"))


def test_a_lexicon_without_language_is_refused_for_the_library_options():
    lexicon = Lexicon(stopwords=frozenset(), synonyms={})

    with pytest.raises(ValueError, match="has no language"):
        tokenize("text", lexicon, options=LexicalOptions(stopwords="stopwordsiso"))
    with pytest.raises(ValueError, match="has no language"):
        tokenize("text", lexicon, options=LexicalOptions(stemmer="snowball"))
