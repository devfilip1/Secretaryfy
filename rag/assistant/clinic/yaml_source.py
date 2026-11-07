"""Perfil da clínica lido de YAML: config/clinic.yaml (a clínica) e config/languages/<idioma>.yaml (o idioma)."""
import re
from pathlib import Path

import yaml

from assistant.clinic.profile import ClinicProfile, ClinicProfileError, Lexicon

LANGUAGE_CODE = re.compile(r"^[a-z][a-z0-9_-]*$")
CLINIC_FIELDS = ("name", "kind", "language", "example_treatment", "extra_rules")
TEXT_FIELDS = (
    "no_answer", "no_information", "no_conversation", "original_separator", "refusal_offer",
    "answer_language", "greeting_examples", "thanks_example", "examples",
)
# Os textos de prompt, iguais para todos os idiomas: config/prompts.yaml.
PROMPT_FIELDS = ("system_prompt", "user_template", "standalone_prompt", "original_template", "hyde_prompt")
# Valores do idioma preenchidos nos prompts. Os exemplos vêm antes: trazem {no_answer}, que fica para a pergunta.
LANGUAGE_PLACEHOLDERS = (
    ("{answer_language}", "answer_language"),
    ("{greeting_examples}", "greeting_examples"),
    ("{thanks_example}", "thanks_example"),
)
PATTERN_FIELDS = ("afterthought", "greeting", "small_talk")
LEXICON_FIELDS = ("stopwords", "query_synonyms")
# Valores da clínica preenchidos nos textos antes de o prompt existir: chaves com chaves não podem entrar.
CLINIC_PLACEHOLDERS = (
    ("{clinic_name_upper}", lambda clinic: clinic["name"].upper()),
    ("{clinic_name}", lambda clinic: clinic["name"]),
    ("{clinic_kind}", lambda clinic: clinic["kind"]),
    ("{example_treatment}", lambda clinic: clinic["example_treatment"]),
    ("{extra_rules}", lambda clinic: clinic["extra_rules"]),
)


def _read_yaml(path):
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as error:
        raise ClinicProfileError(f"{path}: invalid YAML: {' '.join(str(error).split())}") from error
    if not isinstance(data, dict):
        raise ClinicProfileError(f"{path}: the file is empty or is not a mapping of fields")
    return data


def _mtime(path, hint="create it with the clinic's profile"):
    try:
        return path.stat().st_mtime_ns
    except OSError as error:
        raise ClinicProfileError(f"{path} cannot be read ({error.strerror}); {hint}") from error


def _is_string_list(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _check_synonyms(value, file_name):
    """Mapa de cada palavra para uma lista de palavras; o mapa e as listas podem estar vazios."""
    if not isinstance(value, dict) or not all(isinstance(word, str) and _is_string_list(words) for word, words in value.items()):
        raise ClinicProfileError(f"{file_name}: query_synonyms must be a mapping of each word to a list of strings")


def _check_clinic(clinic, path):
    missing = [field for field in CLINIC_FIELDS if not isinstance(clinic.get(field), str) or not clinic[field].strip()]
    if missing:
        raise ClinicProfileError(f"{path.name}: missing or empty field: {', '.join(missing)}")
    for field in CLINIC_FIELDS:
        if "{" in clinic[field] or "}" in clinic[field]:
            raise ClinicProfileError(f"{path.name}: {field} may not contain braces ({{ or }}); they are read as placeholders")
    if not LANGUAGE_CODE.match(clinic["language"]):
        raise ClinicProfileError(f'{path.name}: language "{clinic["language"]}" is not a language code; use a name such as en')
    if "query_synonyms" not in clinic:
        raise ClinicProfileError(f"{path.name}: missing field: query_synonyms")
    _check_synonyms(clinic["query_synonyms"], path.name)


def _check_language(pack, path):
    missing = [field for field in (*TEXT_FIELDS, *PATTERN_FIELDS, *LEXICON_FIELDS, "conversation_roles") if field not in pack]
    if missing:
        raise ClinicProfileError(f"{path.name}: missing field: {', '.join(missing)}")
    wrong = [field for field in TEXT_FIELDS if not isinstance(pack[field], str)]
    roles = pack["conversation_roles"]
    if wrong or not isinstance(roles, dict) or "user" not in roles or "assistant" not in roles:
        raise ClinicProfileError(
            f"{path.name}: the texts must be strings and conversation_roles must have the keys user and assistant "
            f"(wrong: {', '.join(wrong) or 'conversation_roles'})"
        )
    if not _is_string_list(pack["stopwords"]):
        raise ClinicProfileError(f"{path.name}: stopwords must be a list of strings")
    _check_synonyms(pack["query_synonyms"], path.name)


def _check_prompts(prompts, path):
    missing = [field for field in PROMPT_FIELDS if field not in prompts]
    if missing:
        raise ClinicProfileError(f"{path.name}: missing field: {', '.join(missing)}")
    wrong = [field for field in PROMPT_FIELDS if not isinstance(prompts[field], str)]
    if wrong:
        raise ClinicProfileError(f"{path.name}: the prompt texts must be strings (wrong: {', '.join(wrong)})")


def _compile(pack, field, path):
    try:
        return re.compile(pack[field], re.IGNORECASE)
    except (re.error, TypeError) as error:
        raise ClinicProfileError(f"{path.name}: {field} is not a valid regular expression: {error}") from error


def _lexicon(clinic, pack, clinic_path, language_path):
    """Idioma e clínica juntos. Uma palavra nos dois arquivos é erro: não se mescla em silêncio."""
    repeated = [word for word in clinic["query_synonyms"] if word in pack["query_synonyms"]]
    if repeated:
        raise ClinicProfileError(
            f"{clinic_path.name}: query_synonyms repeats words of {language_path.name}: {', '.join(repeated)}; "
            "keep each word in one of the two files"
        )
    merged = {**pack["query_synonyms"], **clinic["query_synonyms"]}
    return Lexicon(
        stopwords=frozenset(pack["stopwords"]),
        synonyms={word: tuple(words) for word, words in merged.items()},
        language=clinic["language"],
        generic_synonyms={word: tuple(words) for word, words in pack["query_synonyms"].items()},
    )


def _build(clinic_path, languages_dir, prompts_path, overrides=None):
    clinic = _read_yaml(clinic_path)
    _check_clinic(clinic, clinic_path)
    if overrides:  # what the Node server holds replaces the file's values (name, kind, example_treatment, extra_rules)
        clinic = {**clinic, **overrides}
    language_path = languages_dir / f"{clinic['language']}.yaml"
    if not language_path.is_file():
        raise ClinicProfileError(
            f'language "{clinic["language"]}" does not exist: {language_path} is missing; '
            "create it or change language in config/clinic.yaml"
        )
    pack = _read_yaml(language_path)
    _check_language(pack, language_path)
    prompts = _read_yaml(prompts_path)
    _check_prompts(prompts, prompts_path)

    def fill(text):
        text = text.replace("{examples}", pack["examples"])  # first: the examples hold {no_answer}, which stays
        for placeholder, field in LANGUAGE_PLACEHOLDERS:
            text = text.replace(placeholder, pack[field])
        for placeholder, value in CLINIC_PLACEHOLDERS:
            text = text.replace(placeholder, value(clinic))
        return text
    return ClinicProfile(
        name=clinic["name"],
        kind=clinic["kind"],
        language=clinic["language"],
        no_answer=pack["no_answer"],
        no_information=pack["no_information"],
        no_conversation=pack["no_conversation"],
        conversation_roles=dict(pack["conversation_roles"]),
        original_separator=pack["original_separator"],
        system_prompt=fill(prompts["system_prompt"]),
        user_template=fill(prompts["user_template"]),
        standalone_prompt=fill(prompts["standalone_prompt"]),
        original_template=fill(prompts["original_template"]),
        hyde_prompt=fill(prompts["hyde_prompt"]),
        afterthought=_compile(pack, "afterthought", language_path),
        greeting=_compile(pack, "greeting", language_path),
        refusal_offer=pack["refusal_offer"],
        small_talk=_compile(pack, "small_talk", language_path),
        lexicon=_lexicon(clinic, pack, clinic_path, language_path),
    )


class YamlClinicProfile:
    """Implementa ClinicProfileSource. Relê os arquivos quando a data de modificação de um deles muda."""
    def __init__(self, clinic_path, languages_dir, prompts_path=None):
        self._clinic_path = Path(clinic_path)
        self._languages_dir = Path(languages_dir)
        # os prompts ficam ao lado da pasta de idiomas: config/prompts.yaml
        self._prompts_path = Path(prompts_path) if prompts_path is not None else self._languages_dir.parent / "prompts.yaml"
        self._loaded = None  # (versão, perfil)

    def version(self):
        files = [self._clinic_path, *sorted(self._languages_dir.glob("*.yaml"))]
        version = ";".join(f"{path.name}:{_mtime(path)}" for path in files)
        prompts = _mtime(self._prompts_path, "create it: it holds the prompt texts shared by every language")
        return f"{version};{self._prompts_path.name}:{prompts}"

    def load(self):
        return self._load(None)

    def load_as(self, name, kind, example_treatment=None, extra_rules=None):
        """The profile with the Node server's values replaced; the file's values are kept for everything else."""
        values = {"name": name, "kind": kind, "example_treatment": example_treatment, "extra_rules": extra_rules}
        return self._load({field: value for field, value in values.items() if value})

    def _load(self, overrides):
        key = (self.version(), tuple(sorted(overrides.items())) if overrides else None)
        if self._loaded is None or self._loaded[0] != key:
            self._loaded = (key, _build(self._clinic_path, self._languages_dir, self._prompts_path, overrides))
        return self._loaded[1]
