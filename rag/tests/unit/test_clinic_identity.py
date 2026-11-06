"""The clinic's name and kind come from the Node server when CLINIC_URL is set; the YAML profile keeps the rest."""
import json
import logging
from types import SimpleNamespace

import pytest

from assistant import config
from assistant.clinic.identity import ClinicIdentity, HttpClinicIdentity, IdentityClinicProfile
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


def test_a_language_that_differs_from_the_yaml_is_warned_and_not_switched(caplog):
    other = {**NODE_IDENTITY, "language": OTHER_LANGUAGE}
    identity = HttpClinicIdentity(URL, TOKEN, fetch=FakeFetch((200, json.dumps(other))))
    source = IdentityClinicProfile(yaml_profile(), identity)

    with caplog.at_level(logging.WARNING):
        profile = source.load()

    assert profile.name == "Clínica Nova"
    assert profile.language == YAML.language
    assert any("language" in r.getMessage() for r in caplog.records)


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
