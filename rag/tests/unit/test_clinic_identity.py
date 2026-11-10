"""The clinic's name and kind come from the Node server when CLINIC_URL is set; the YAML profile keeps the rest."""
import json
import logging
from types import SimpleNamespace

import pytest
import yaml

from assistant import config
from assistant.clinic.identity import ClinicIdentity, HttpClinicIdentity, IdentityClinicProfile, Treatment, example_treatment, extra_rules
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.generation.prompting import build_prompt
from assistant.retrieval.pipeline import RagConfig
from assistant.storage import factory

URL = "http://127.0.0.1:3000/internal/clinic"
TOKEN = "internal-test-token"
YAML = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR).load()  # the fallback: config/clinic.yaml
YAML_NAME = YAML.name
OTHER_LANGUAGE = "pt" if YAML.language != "pt" else "en"
NODE_IDENTITY = {"name": "Clínica Nova", "kind": "clínica de estética", "language": YAML.language}


class FakeFetch:
    """Answers the identity like the Node server; `answer` is changed by the test to simulate a rename."""

    def __init__(self, answer=None, error=None):
        self.calls = 0
        self.answer = answer if answer is not None else (200, json.dumps(NODE_IDENTITY))
        self.error = error

    def __call__(self, url, token):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.answer


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FakeIdentity:
    def __init__(self, identity):
        self.identity = identity

    def current(self):
        return self.identity


def yaml_profile():
    return YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR)


def question_prompt(clinic):
    config_ = RagConfig.from_experiment("section_hybrid")
    retrieval = SimpleNamespace(fused=[])
    return build_prompt("quanto custa o clareamento?", retrieval, config_, clinic).messages[0].content


def test_the_prompt_of_a_question_carries_the_node_name_after_a_rename():
    identity = FakeIdentity(None)
    source = IdentityClinicProfile(yaml_profile(), identity)

    before = question_prompt(source.load())
    identity.identity = ClinicIdentity("Clínica Nova", "clínica de estética", YAML.language)
    after = question_prompt(source.load())

    assert YAML_NAME in before
    assert "Clínica Nova" in after
    assert YAML_NAME not in after


def test_the_name_and_kind_are_replaced_and_the_rest_of_the_profile_is_kept():
    identity = FakeIdentity(HttpClinicIdentity(URL, TOKEN, fetch=FakeFetch()).current())
    profile = IdentityClinicProfile(yaml_profile(), identity).load()
    yaml = yaml_profile().load()

    assert (profile.name, profile.kind) == ("Clínica Nova", "clínica de estética")
    assert profile.no_answer == yaml.no_answer
    assert profile.lexicon == yaml.lexicon


@pytest.mark.parametrize(
    "answer",
    [
        {"error": ConnectionError("refused")},
        {"answer": (401, "")},
        {"answer": (200, "not json")},
        {"answer": (200, json.dumps({"name": "Clínica", "language": "pt"}))},
        {"answer": (200, json.dumps({"name": "Clínica {x}", "kind": "clínica", "language": "pt"}))},
    ],
)
def test_the_yaml_values_are_used_when_the_node_server_cannot_give_a_valid_identity(answer, caplog):
    fetch = FakeFetch(**answer)
    identity = HttpClinicIdentity(URL, TOKEN, fetch=fetch)
    source = IdentityClinicProfile(yaml_profile(), identity)

    with caplog.at_level(logging.WARNING):
        first = source.load()
        second = source.load()

    assert first.name == YAML_NAME and second.name == YAML_NAME
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1  # at most once


def test_a_language_that_differs_from_the_yaml_switches_the_language_pack():
    other = {**NODE_IDENTITY, "language": OTHER_LANGUAGE}
    identity = HttpClinicIdentity(URL, TOKEN, fetch=FakeFetch((200, json.dumps(other))))
    profile = IdentityClinicProfile(yaml_profile(), identity).load()
    pack = yaml.safe_load((LANGUAGES_DIR / f"{OTHER_LANGUAGE}.yaml").read_text(encoding="utf-8"))

    assert profile.name == "Clínica Nova"
    assert profile.language == OTHER_LANGUAGE
    assert profile.no_answer == pack["no_answer"]
    assert profile.refusal_offer == pack["refusal_offer"]
    assert pack["answer_language"] in profile.system_prompt
    assert YAML.lexicon.stopwords != profile.lexicon.stopwords
    assert "whiten" not in profile.lexicon.synonyms  # a query synonym of the YAML language is not applied


@pytest.mark.parametrize("language", ["xx", "../en"])
def test_a_language_without_a_pack_falls_back_to_the_yaml_language_with_a_warning(language, caplog):
    identity = HttpClinicIdentity(URL, TOKEN, fetch=FakeFetch((200, json.dumps({**NODE_IDENTITY, "language": language}))))
    source = IdentityClinicProfile(yaml_profile(), identity)

    with caplog.at_level(logging.WARNING):
        profile = source.load()

    assert profile.name == "Clínica Nova"
    assert profile.language == YAML.language
    assert profile.no_answer == YAML.no_answer
    assert profile.lexicon.synonyms == YAML.lexicon.synonyms
    assert any(language in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)


def test_the_version_changes_with_the_language_so_the_index_is_rebuilt():
    same = ClinicIdentity("Clínica Nova", "clínica", YAML.language)
    other = ClinicIdentity("Clínica Nova", "clínica", OTHER_LANGUAGE)

    version_same = IdentityClinicProfile(yaml_profile(), FakeIdentity(same)).version()
    version_other = IdentityClinicProfile(yaml_profile(), FakeIdentity(other)).version()

    assert version_same != version_other


def test_the_identity_is_fetched_once_within_the_ttl_and_again_after_it():
    fetch, clock = FakeFetch(), Clock()
    identity = HttpClinicIdentity(URL, TOKEN, fetch=fetch, clock=clock, ttl_s=5.0)

    identity.current()
    clock.now += 4.5
    identity.current()
    assert fetch.calls == 1

    clock.now += 0.5
    identity.current()
    assert fetch.calls == 2


def test_a_rename_applies_on_the_next_question_after_the_ttl():
    fetch, clock = FakeFetch(), Clock()
    source = IdentityClinicProfile(yaml_profile(), HttpClinicIdentity(URL, TOKEN, fetch=fetch, clock=clock, ttl_s=5.0))
    assert source.load().name == "Clínica Nova"

    fetch.answer = (200, json.dumps({**NODE_IDENTITY, "name": "Outra Clínica"}))
    assert source.load().name == "Clínica Nova"  # still within the TTL

    clock.now += 5.0
    assert source.load().name == "Outra Clínica"


def test_the_factory_uses_the_node_identity_only_when_clinic_url_is_set(monkeypatch):
    factory.reset_default_clinic_profile()
    monkeypatch.setattr(config, "CLINIC_URL", "")
    try:
        assert isinstance(factory.default_clinic_profile(), YamlClinicProfile)

        factory.reset_default_clinic_profile()
        monkeypatch.setattr(config, "CLINIC_URL", URL)
        assert isinstance(factory.default_clinic_profile(), IdentityClinicProfile)
    finally:
        factory.reset_default_clinic_profile()


def test_other_names_of_a_treatment_become_query_synonyms_and_change_the_version():
    identity = ClinicIdentity("Clínica Nova", "clínica", YAML.language, treatments=(Treatment("Clareamento Dental", ("Branqueamento", "tirar manchas")),))
    profile = IdentityClinicProfile(YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR), FakeIdentity(identity))
    synonyms = profile.load().lexicon.synonyms
    assert synonyms["branqueamento"][:2] == ("clareamento", "dental")
    assert synonyms["manchas"] == ("clareamento", "dental")
    plain = IdentityClinicProfile(YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR), FakeIdentity(ClinicIdentity("A", "b", YAML.language)))
    assert profile.version() != plain.version()


def test_example_treatment_and_extra_rules_come_from_the_treatments():
    treatments = (Treatment("Limpeza Dental"), Treatment("Aparelho", extra_labels=("Custo inicial", "Mensalidade")), Treatment("Siso {x}", extra_labels=("a",)))
    assert example_treatment(treatments) == "limpeza dental"
    rule = extra_rules(treatments)
    assert rule.startswith("5. ") and 'Aparelho: "Custo inicial", "Mensalidade".' in rule and "{" not in rule
    assert extra_rules((Treatment("Limpeza Dental"),)) is None
    profile = IdentityClinicProfile(YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR), FakeIdentity(ClinicIdentity("A", "b", YAML.language, treatments)))
    assert '"Mensalidade"' in profile.load().system_prompt and "limpeza dental" in profile.load().system_prompt
