import os
import pytest
import yaml

from assistant.clinic.profile import ClinicProfileError
from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR

REAL_PACK = yaml.safe_load((LANGUAGES_DIR / "en.yaml").read_text(encoding="utf-8"))
CLINIC = {
    "name": "Smile Lab",
    "kind": "dental clinic",
    "language": "en",
    "example_treatment": "teeth whitening",
    "extra_rules": "5. Rule about two prices.",
    "query_synonyms": {},
}


def write_profile(directory, clinic=CLINIC, pack=REAL_PACK, language="en"):
    """Writes config/clinic.yaml and config/languages/<language>.yaml under directory; returns the two paths."""
    clinic_path = directory / "clinic.yaml"
    languages = directory / "languages"
    languages.mkdir(exist_ok=True)
    clinic_path.write_text(yaml.safe_dump(clinic, allow_unicode=True), encoding="utf-8")
    if pack is not None:
        (languages / f"{language}.yaml").write_text(yaml.safe_dump(pack, allow_unicode=True), encoding="utf-8")
    return clinic_path, languages


def load(directory):
    clinic_path, languages = write_profile(directory)
    return YamlClinicProfile(clinic_path, languages)


def test_the_real_profile_fills_the_clinic_into_the_texts():
    profile = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR).load()

    assert (profile.name, profile.kind, profile.language) == ("DentalSafe", "dental clinic", "en")
    assert "virtual assistant of DentalSafe, a dental clinic." in profile.system_prompt
    assert "ABOUT DENTALSAFE" in profile.system_prompt and "ABOUT DENTALSAFE" in profile.user_template
    assert '(for example "teeth whitening")' in profile.system_prompt
    assert "5. Some treatments have two prices" in profile.system_prompt
    assert "{no_answer}" in profile.system_prompt  # the question fills it, not the profile
    assert "{clinic_" not in profile.system_prompt + profile.user_template + profile.original_template


def test_the_clinic_name_fills_the_baseline_and_hyde_texts_too():
    profile = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR).load()

    assert "an assistant of the DentalSafe clinic." in profile.original_template
    assert "answer that a dental clinic's brochure would give" in profile.hyde_prompt


def test_a_new_clinic_name_is_used_in_every_text(tmp_path):
    clinic = {**CLINIC, "name": "Smile Lab", "kind": "veterinary clinic"}
    clinic_path, languages = write_profile(tmp_path, clinic=clinic)

    profile = YamlClinicProfile(clinic_path, languages).load()

    assert "virtual assistant of Smile Lab, a veterinary clinic." in profile.system_prompt
    assert "ABOUT SMILE LAB" in profile.user_template
    assert "of the Smile Lab clinic." in profile.original_template
    assert "a veterinary clinic's brochure" in profile.hyde_prompt


@pytest.mark.parametrize("field", ["name", "kind", "language", "example_treatment", "extra_rules"])
def test_a_missing_or_empty_clinic_field_is_refused_by_name(tmp_path, field):
    clinic = {key: value for key, value in CLINIC.items() if key != field}
    clinic_path, languages = write_profile(tmp_path, clinic=clinic)
    with pytest.raises(ClinicProfileError, match=f"missing or empty field: {field}"):
        YamlClinicProfile(clinic_path, languages).load()

    clinic_path, languages = write_profile(tmp_path, clinic={**CLINIC, field: "   "})
    with pytest.raises(ClinicProfileError, match=f"missing or empty field: {field}"):
        YamlClinicProfile(clinic_path, languages).load()


def test_a_language_without_a_file_is_refused_with_the_file_to_create(tmp_path):
    clinic_path, languages = write_profile(tmp_path, clinic={**CLINIC, "language": "pt"}, pack=None)

    with pytest.raises(ClinicProfileError) as info:
        YamlClinicProfile(clinic_path, languages).load()

    assert 'language "pt" does not exist' in str(info.value)
    assert "pt.yaml is missing" in str(info.value)


@pytest.mark.parametrize("language", ["../en", "EN", "en/us"])
def test_a_language_that_is_not_a_code_is_refused(tmp_path, language):
    clinic_path, languages = write_profile(tmp_path, clinic={**CLINIC, "language": language}, pack=None)

    with pytest.raises(ClinicProfileError, match="is not a language code"):
        YamlClinicProfile(clinic_path, languages).load()


@pytest.mark.parametrize("field", ["name", "extra_rules"])
def test_braces_in_a_clinic_value_are_refused_because_they_would_be_placeholders(tmp_path, field):
    clinic_path, languages = write_profile(tmp_path, clinic={**CLINIC, field: "Hours {open}"})

    with pytest.raises(ClinicProfileError, match=f"{field} may not contain braces"):
        YamlClinicProfile(clinic_path, languages).load()


@pytest.mark.parametrize("field", ["system_prompt", "no_answer", "conversation_roles", "greeting", "refusal_offer", "small_talk"])
def test_a_language_file_missing_a_field_is_refused_by_name(tmp_path, field):
    pack = {key: value for key, value in REAL_PACK.items() if key != field}
    clinic_path, languages = write_profile(tmp_path, pack=pack)

    with pytest.raises(ClinicProfileError, match=f"missing field: {field}"):
        YamlClinicProfile(clinic_path, languages).load()


def test_an_invalid_small_talk_pattern_is_refused_with_its_field(tmp_path):
    clinic_path, languages = write_profile(tmp_path, pack={**REAL_PACK, "small_talk": "(unclosed"})

    with pytest.raises(ClinicProfileError, match="small_talk is not a valid regular expression"):
        YamlClinicProfile(clinic_path, languages).load()


def test_conversation_roles_need_the_user_and_assistant_keys(tmp_path):
    clinic_path, languages = write_profile(tmp_path, pack={**REAL_PACK, "conversation_roles": {"user": "Customer"}})

    with pytest.raises(ClinicProfileError, match="conversation_roles must have the keys user and assistant"):
        YamlClinicProfile(clinic_path, languages).load()


def test_a_text_that_is_not_a_string_is_refused(tmp_path):
    clinic_path, languages = write_profile(tmp_path, pack={**REAL_PACK, "hyde_prompt": ["a", "list"]})

    with pytest.raises(ClinicProfileError, match="hyde_prompt"):
        YamlClinicProfile(clinic_path, languages).load()


def test_an_invalid_regular_expression_is_refused_with_its_field(tmp_path):
    clinic_path, languages = write_profile(tmp_path, pack={**REAL_PACK, "greeting": "(unclosed"})

    with pytest.raises(ClinicProfileError, match="greeting is not a valid regular expression"):
        YamlClinicProfile(clinic_path, languages).load()


def test_invalid_yaml_is_refused_with_the_file_name(tmp_path):
    clinic_path = tmp_path / "clinic.yaml"
    clinic_path.write_text("name: [unclosed", encoding="utf-8")

    with pytest.raises(ClinicProfileError, match="clinic.yaml: invalid YAML"):
        YamlClinicProfile(clinic_path, tmp_path).load()


def test_a_file_that_is_not_a_mapping_is_refused(tmp_path):
    clinic_path = tmp_path / "clinic.yaml"
    clinic_path.write_text("- just\n- a list\n", encoding="utf-8")

    with pytest.raises(ClinicProfileError, match="not a mapping"):
        YamlClinicProfile(clinic_path, tmp_path).load()


def test_a_missing_clinic_file_is_refused_with_how_to_fix_it(tmp_path):
    source = YamlClinicProfile(tmp_path / "absent.yaml", tmp_path)

    with pytest.raises(ClinicProfileError, match="create it with the clinic's profile"):
        source.load()


def test_the_version_changes_when_the_clinic_file_changes_and_the_profile_is_reloaded(tmp_path):
    source = load(tmp_path)
    first_version, first = source.version(), source.load()
    assert source.load() is first  # unchanged: the same object, not read again

    clinic_path = tmp_path / "clinic.yaml"
    clinic_path.write_text(yaml.safe_dump({**CLINIC, "name": "Smile Two"}, allow_unicode=True), encoding="utf-8")
    later = clinic_path.stat().st_mtime_ns + 2_000_000_000  # the clock is not used: the file gets a later time
    os.utime(clinic_path, ns=(later, later))

    assert source.version() != first_version
    assert source.load().name == "Smile Two"


def test_the_version_changes_when_a_language_file_changes(tmp_path):
    source = load(tmp_path)
    before = source.version()

    language_path = tmp_path / "languages" / "en.yaml"
    later = language_path.stat().st_mtime_ns + 2_000_000_000
    os.utime(language_path, ns=(later, later))

    assert source.version() != before
