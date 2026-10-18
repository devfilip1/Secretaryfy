"""Chunking strategies and search experiments, read from config/strategies.yaml and config/experiments.yaml."""
import hashlib
import json
from dataclasses import dataclass, field
from functools import lru_cache

import jsonschema
import yaml

from assistant.config import EXPERIMENTS_PATH, SCHEMAS_DIR, STRATEGIES_PATH

STRATEGY_TYPES = ("section", "split", "page")
SEARCH_TYPES = ("hybrid", "vector", "bm25")
PROMPTS = ("rules", "original")
TYPE_DEFAULTS = {"section": {"max_chars": 1200, "overlap": 100}, "split": {}, "page": {}}
# (size, overlap) pair of each type: the overlap must be smaller than the size
SIZE_AND_OVERLAP = {"section": ("max_chars", "overlap"), "split": ("chunk_size", "chunk_overlap")}


class SettingsError(Exception):
    """Invalid configuration. problems has one message per problem, saying what to fix."""

    def __init__(self, problems):
        super().__init__("\n".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class Strategy:
    name: str
    type: str
    parameters: dict = field(default_factory=dict, hash=False)

    def definition_hash(self):
        """Changes when the type or the parameters change: it is what tells whether an index is out of date."""
        definition = json.dumps({"type": self.type, "parameters": self.parameters}, sort_keys=True)
        return hashlib.sha256(definition.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Experiment:
    exp_name: str
    collection: str
    search_type: str
    match_count: int
    match_threshold: float = 0.0
    use_hyde: bool = False
    prompt: str = "rules"


@dataclass(frozen=True)
class Settings:
    strategies: dict  # name -> Strategy, in file order
    experiments: dict  # name -> Experiment, in file order
    assistant: Experiment


def _schema(name):
    return json.loads((SCHEMAS_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


def _load_yaml(text, file_name, problems):
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as error:
        problems.append(f"{file_name}: invalid YAML: {' '.join(str(error).split())}")
        return None
    if not isinstance(data, dict):
        problems.append(f"{file_name}: the file is empty or does not have the expected structure")
        return None
    return data


def _item_label(data, error, list_key, name_key):
    """Name of the item where the error happened, so the message points to the right place."""
    path = list(error.absolute_path)
    if len(path) >= 2 and path[0] == list_key and isinstance(path[1], int):
        item = data[list_key][path[1]]
        name = item.get(name_key) if isinstance(item, dict) else None
        label = f"\"{name}\"" if isinstance(name, str) else f"item {path[1] + 1}"
        return label, [str(part) for part in path[2:]]
    return None, [str(part) for part in path]


def _describe(error, label, where):
    """Turns a schema error into an instruction of what to fix."""
    target = f"{label}: " if label else ""
    name = where[-1] if where else None
    validator = error.validator

    if validator == "required":
        missing = [key for key in error.validator_value if key not in error.instance]
        if where and where[-1] == "parameters":
            return f"{target}missing required parameters: {', '.join(missing)}"
        return f"{target}missing required field: {', '.join(missing)}"
    if validator == "additionalProperties":
        allowed = set(error.schema.get("properties", {}))
        unknown = [key for key in error.instance if key not in allowed]
        kind = "unknown parameter" if where and where[-1] == "parameters" else "unknown field"
        hint = f" (accepted: {', '.join(sorted(allowed))})" if allowed else ""
        return f"{target}{kind}: {', '.join(unknown)}{hint}"
    if validator == "maxProperties":
        return f"{target}this type takes no parameters; remove: {', '.join(error.instance)}"
    if validator == "enum":
        options = ", ".join(str(option) for option in error.validator_value)
        return f"{target}{name} \"{error.instance}\" does not exist; use one of: {options}"
    if validator in ("minimum", "maximum"):
        schema = error.schema
        if "minimum" in schema and "maximum" in schema:
            limits = f"from {schema['minimum']} to {schema['maximum']}"
        elif "minimum" in schema:
            limits = f"at least {schema['minimum']}"
        else:
            limits = f"at most {schema['maximum']}"
        return f"{target}{name} is {error.instance}; the value must be {limits}"
    if validator == "pattern":
        return f"{target}invalid name \"{error.instance}\": use only lower-case letters, digits, and _"
    if validator == "minItems":
        return f"{name or where}: declare at least one item"
    if validator == "type":
        return f"{target}{name} has the value {error.instance!r}, which is not of the expected type ({error.validator_value})"
    return f"{target}{'/'.join(where)}: {error.message}"


def _schema_problems(data, schema_name, list_key, name_key, file_name):
    problems = []
    validator = jsonschema.Draft202012Validator(_schema(schema_name))
    for error in sorted(validator.iter_errors(data), key=lambda e: [str(part) for part in e.absolute_path]):
        label, where = _item_label(data, error, list_key, name_key)
        problems.append(f"{file_name}: {_describe(error, label, where)}")
    return problems


def _duplicates(items, name_key):
    seen, repeated = set(), []
    for item in items:
        name = item.get(name_key) if isinstance(item, dict) else None
        if isinstance(name, str):
            if name in seen and name not in repeated:
                repeated.append(name)
            seen.add(name)
    return repeated


def parse_settings(strategies_text, experiments_text):
    """Validates the two files and returns Settings. Raises SettingsError with every problem found."""
    problems = []
    strategies_file, experiments_file = "config/strategies.yaml", "config/experiments.yaml"
    strategies_data = _load_yaml(strategies_text, strategies_file, problems)
    experiments_data = _load_yaml(experiments_text, experiments_file, problems)

    strategies = {}
    if strategies_data is not None:
        problems += _schema_problems(strategies_data, "strategies", "strategies", "name", strategies_file)
        raw_strategies = strategies_data.get("strategies")
        raw_strategies = raw_strategies if isinstance(raw_strategies, list) else []
        for name in _duplicates(raw_strategies, "name"):
            problems.append(f"{strategies_file}: duplicate strategy name: \"{name}\"; each strategy needs a unique name")
        for raw in raw_strategies:
            if not isinstance(raw, dict) or raw.get("type") not in STRATEGY_TYPES or not isinstance(raw.get("name"), str):
                continue
            given = raw.get("parameters") if isinstance(raw.get("parameters"), dict) else {}
            parameters = {**TYPE_DEFAULTS[raw["type"]], **given}
            pair = SIZE_AND_OVERLAP.get(raw["type"])
            if pair and all(isinstance(parameters.get(key), int) for key in pair):
                size, overlap = pair
                if parameters[overlap] >= parameters[size]:
                    problems.append(
                        f"{strategies_file}: \"{raw['name']}\": {overlap} ({parameters[overlap]}) must be smaller "
                        f"than {size} ({parameters[size]})"
                    )
            strategies.setdefault(raw["name"], Strategy(raw["name"], raw["type"], parameters))

    experiments = {}
    assistant = None
    if experiments_data is not None:
        problems += _schema_problems(experiments_data, "experiments", "experiments", "exp_name", experiments_file)
        raw_experiments = experiments_data.get("experiments")
        raw_experiments = raw_experiments if isinstance(raw_experiments, list) else []
        for name in _duplicates(raw_experiments, "exp_name"):
            problems.append(f"{experiments_file}: duplicate experiment name: \"{name}\"; each experiment needs a unique name")
        for raw in raw_experiments:
            if not isinstance(raw, dict) or not isinstance(raw.get("exp_name"), str):
                continue
            name = raw["exp_name"]
            collection = raw.get("collection")
            if strategies_data is not None and isinstance(collection, str) and collection not in strategies:
                problems.append(
                    f"{experiments_file}: \"{name}\": the strategy \"{collection}\" does not exist in {strategies_file}; "
                    f"use one of: {', '.join(strategies) or '(no valid one)'}"
                )
            if raw.get("use_hyde") is True and raw.get("search_type") == "bm25":
                problems.append(
                    f"{experiments_file}: \"{name}\": use_hyde only works with vector search; "
                    "change search_type bm25 to hybrid or vector, or turn use_hyde off"
                )
            try:
                experiments.setdefault(name, Experiment(
                    exp_name=name,
                    collection=raw["collection"],
                    search_type=raw["search_type"],
                    match_count=raw["match_count"],
                    match_threshold=float(raw.get("match_threshold", 0.0)),
                    use_hyde=raw.get("use_hyde", False),
                    prompt=raw.get("prompt", "rules"),
                ))
            except (KeyError, TypeError, ValueError):
                pass  # the schema already listed the problem
        chosen = experiments_data.get("assistant")
        if isinstance(chosen, str):
            assistant = experiments.get(chosen)
            declared = [raw.get("exp_name") for raw in raw_experiments if isinstance(raw, dict)]
            if chosen not in declared:
                problems.append(
                    f"{experiments_file}: assistant points to \"{chosen}\", which is not a declared experiment; "
                    f"use one of: {', '.join(str(name) for name in declared) or '(none)'}"
                )

    if problems:
        raise SettingsError(problems)
    return Settings(strategies=strategies, experiments=experiments, assistant=assistant)


@lru_cache(maxsize=1)
def load_settings():
    """Reads and validates the two configuration files. The result is cached for the run."""
    problems = []
    texts = []
    for path in (STRATEGIES_PATH, EXPERIMENTS_PATH):
        try:
            texts.append(path.read_text(encoding="utf-8"))
        except OSError:
            problems.append(f"config/{path.name}: file not found at {path}")
    if problems:
        raise SettingsError(problems)
    return parse_settings(*texts)


def strategies():
    return list(load_settings().strategies.values())


def experiments():
    return list(load_settings().experiments.values())


def get_strategy(name):
    """Strategy by name. KeyError with the list of valid ones if it does not exist."""
    found = load_settings().strategies
    if name not in found:
        raise KeyError(f"the strategy \"{name}\" does not exist; use one of: {', '.join(found)}")
    return found[name]


def get_experiment(name):
    """Experiment by name. KeyError with the list of valid ones if it does not exist."""
    found = load_settings().experiments
    if name not in found:
        raise KeyError(f"the experiment \"{name}\" does not exist; use one of: {', '.join(found)}")
    return found[name]


def assistant_experiment():
    """The experiment that the chat and the answer evaluation use."""
    return load_settings().assistant
