from pathlib import Path

import pytest

from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.retrieval.lexical import tokenize
from assistant.retrieval.lexical_options import LexicalOptions
from evaluation.answer_metrics import detect_abstention
from evaluation.normalize import PT

CONFIG = Path(__file__).resolve().parents[2] / "config"
LIBRARIES = LexicalOptions(stopwords="stopwordsiso", stemmer="snowball", synonyms="none")


@pytest.fixture(scope="module")
def profile():
    return YamlClinicProfile(CONFIG / "clinics" / "sorrisopleno.yaml", CONFIG / "languages").load()


def test_the_portuguese_profile_loads_with_the_clinic_values_filled(profile):
    assert (profile.name, profile.language) == ("Sorriso Pleno", "pt")
    assert "Sorriso Pleno, uma clínica odontológica" in profile.system_prompt
    assert "SOBRE SORRISO PLENO" in profile.user_template
    assert "clareamento dental" in profile.system_prompt
    assert '5. Alguns tratamentos têm dois preços' in profile.system_prompt
    assert "{clinic" not in profile.system_prompt and "{example" not in profile.system_prompt and "{extra" not in profile.system_prompt


def test_the_refusal_sentence_is_recognized_by_the_evaluation(profile):
    assert detect_abstention(profile.no_answer, PT)


def test_the_greeting_and_the_afterthought_are_cut_in_portuguese(profile):
    assert profile.greeting.sub("", "Olá! O clareamento custa R$ 180 a R$ 450.") == "O clareamento custa R$ 180 a R$ 450."
    assert profile.greeting.sub("", "Oi, tudo bem? Fazemos sim.") == "Fazemos sim."
    assert profile.afterthought.split("Fazemos sim.\n\n(Obs.: texto para si)")[0] == "Fazemos sim."


def test_the_word_search_reads_portuguese_with_the_libraries(profile):
    # the library's stop word list also drops "quanto" and "custa", which carry the intent of a price question:
    # the vector search has to find those questions (measured in Stage 6c)
    assert tokenize("Quanto custa o clareamento dos dentes?", profile.lexicon, False, LIBRARIES) == ["clareament", "dent"]
    assert tokenize("Vocês abrem aos domingos?", profile.lexicon, False, LIBRARIES) == ["abrem", "doming"]
    assert tokenize("Qual o horário de funcionamento no sábado?", profile.lexicon, False, LIBRARIES) == ["horari", "funcion", "sab"]
