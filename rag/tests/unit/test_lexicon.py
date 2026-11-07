"""Lexicon of the word search: it comes from the language and from the clinic, and it is the dictionary the code had before."""
import json
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
import yaml

from assistant.clinic.profile import ClinicProfileError, Lexicon
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR

GOLDEN = Path(__file__).parent / "golden" / "lexicon.json"
REAL_PACK = yaml.safe_load((LANGUAGES_DIR / "en.yaml").read_text(encoding="utf-8"))
REAL_PROMPTS = yaml.safe_load((LANGUAGES_DIR.parent / "prompts.yaml").read_text(encoding="utf-8"))
REAL_CLINIC = yaml.safe_load(CLINIC_PATH.read_text(encoding="utf-8"))
CLINIC = {
    "name": "Smile Lab",
    "kind": "dental clinic",
    "language": "en",
    "example_treatment": "teeth whitening",
    "extra_rules": "5. Rule about two prices.",
    "query_synonyms": {"whiten": ["whitening"]},
}


def write_profile(directory, clinic=CLINIC, pack=REAL_PACK):
    """Writes config/clinic.yaml, config/languages/en.yaml and config/prompts.yaml under directory; returns the source."""
    clinic_path = directory / "clinic.yaml"
    languages = directory / "languages"
    languages.mkdir(exist_ok=True)
    clinic_path.write_text(yaml.safe_dump(clinic, allow_unicode=True), encoding="utf-8")
    if pack is not None:
        (languages / "en.yaml").write_text(yaml.safe_dump(pack, allow_unicode=True), encoding="utf-8")
    (directory / "prompts.yaml").write_text(yaml.safe_dump(REAL_PROMPTS, allow_unicode=True), encoding="utf-8")
    return YamlClinicProfile(clinic_path, languages)


def test_the_real_lexicon_is_the_dictionary_the_code_had_before_the_profile():
    fixture = json.loads(GOLDEN.read_text(encoding="utf-8"))
    lexicon = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR).load().lexicon

    assert lexicon.stopwords == frozenset(fixture["stopwords"])
    assert lexicon.synonyms == {word: tuple(values) for word, values in fixture["query_synonyms"].items()}


def test_generic_words_are_in_the_language_and_specialty_words_in_the_clinic():
    assert {"cost", "open", "phone"} <= set(REAL_PACK["query_synonyms"])
    assert {"whiten", "aligners", "cavity"} <= set(REAL_CLINIC["query_synonyms"])
    assert not set(REAL_PACK["query_synonyms"]) & set(REAL_CLINIC["query_synonyms"])


def test_a_valid_lexicon_is_a_frozen_lexicon(tmp_path):
    lexicon = write_profile(tmp_path).load().lexicon

    assert isinstance(lexicon, Lexicon)
    assert lexicon.synonyms["whiten"] == ("whitening",)
    assert "the" in lexicon.stopwords
    with pytest.raises(FrozenInstanceError):
        lexicon.stopwords = frozenset()


@pytest.mark.parametrize("field", ["stopwords", "query_synonyms"])
def test_a_language_file_without_a_lexicon_field_is_refused_by_name(tmp_path, field):
    pack = {key: value for key, value in REAL_PACK.items() if key != field}

    with pytest.raises(ClinicProfileError, match=f"missing field: {field}"):
        write_profile(tmp_path, pack=pack).load()


def test_a_clinic_without_query_synonyms_is_refused_by_name(tmp_path):
    clinic = {key: value for key, value in CLINIC.items() if key != "query_synonyms"}

    with pytest.raises(ClinicProfileError, match="missing field: query_synonyms"):
        write_profile(tmp_path, clinic=clinic).load()


@pytest.mark.parametrize(
    "pack_values, message",
    [
        ({"stopwords": "a the of"}, "stopwords must be a list of strings"),
        ({"stopwords": ["a", 3]}, "stopwords must be a list of strings"),
        ({"query_synonyms": ["cost", "price"]}, "query_synonyms must be a mapping"),
        ({"query_synonyms": {"cost": "price"}}, "query_synonyms must be a mapping"),
    ],
)
def test_a_language_lexicon_of_the_wrong_type_is_refused(tmp_path, pack_values, message):
    with pytest.raises(ClinicProfileError, match=message):
        write_profile(tmp_path, pack={**REAL_PACK, **pack_values}).load()


def test_a_clinic_mapping_of_the_wrong_type_is_refused(tmp_path):
    clinic = {**CLINIC, "query_synonyms": {"whiten": "whitening"}}

    with pytest.raises(ClinicProfileError, match="query_synonyms must be a mapping"):
        write_profile(tmp_path, clinic=clinic).load()


def test_a_word_in_both_files_is_refused_and_not_merged_silently(tmp_path):
    clinic = {**CLINIC, "query_synonyms": {"cost": ["fee"]}}

    with pytest.raises(ClinicProfileError, match="repeats words of en.yaml: cost"):
        write_profile(tmp_path, clinic=clinic).load()
