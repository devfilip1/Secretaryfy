"""Answer key of questions: loading, validation, and subsets."""
import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import jsonschema

from evaluation.normalize import FACT_UNITS, extract_values, normalize_text

PACKAGE_DIR = Path(__file__).parent
ANSWER_KEY_PATH = PACKAGE_DIR / "data" / "answer_key.json"
SCHEMA_PATH = PACKAGE_DIR / "schemas" / "answer_key.schema.json"

MIN_ITEMS = 60
MIN_UNANSWERABLE = 6
MIN_CLINIC_INFO = 8
REQUIRED_CATEGORIES_PER_PROCEDURE = ("price", "duration", "result")
# entries of "procedures" that are not treatments: they have anchors, but no price, duration, or result
NON_TREATMENT_PROCEDURES = ("clinic",)
SUBSETS = ("dev", "holdout", "smoke")


class AnswerKeyError(Exception):
    def __init__(self, problems):
        super().__init__("\n".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class Fact:
    type: str
    label: str
    values: tuple = ()
    unit: str | None = None
    alternatives: tuple = ()

    def targets(self):
        """Keys (kind, value, unit) in the same format as normalize.Value.key."""
        if self.type in ("money", "time"):
            return [(self.type, round(float(v), 2), None) for v in self.values]
        if self.type == "duration":
            factor, unit = FACT_UNITS[self.unit]
            return [("duration", round(float(v) * factor, 2), unit) for v in self.values]
        return []


@dataclass(frozen=True)
class Item:
    id: str
    question: str
    category: str
    procedure: str | None
    answerable: bool
    split: str
    smoke: bool
    expected_facts: tuple = ()
    allowed_facts: tuple = ()
    evidence: tuple = ()
    variant_of: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class AnswerKey:
    version: str
    hash: str
    procedures: dict = field(default_factory=dict)  # name -> list of anchors
    items: tuple = ()

    def by_id(self):
        return {item.id: item for item in self.items}

    def anchors(self, procedure):
        return self.procedures.get(procedure, []) if procedure else []


def _fact(raw):
    return Fact(
        type=raw["type"],
        label=raw["label"],
        values=tuple(raw.get("values", ())),
        unit=raw.get("unit"),
        alternatives=tuple(raw.get("alternatives", ())),
    )


def parse_answer_key(data, file_hash=""):
    """Builds the answer key from the JSON already read. Raises AnswerKeyError if it does not follow the schema."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.path))
    if errors:
        raise AnswerKeyError([f"schema: {'/'.join(map(str, e.path)) or '(root)'}: {e.message}" for e in errors])

    items = tuple(
        Item(
            id=raw["id"],
            question=raw["question"],
            category=raw["category"],
            procedure=raw["procedure"],
            answerable=raw["answerable"],
            split=raw["split"],
            smoke=raw["smoke"],
            expected_facts=tuple(_fact(f) for f in raw.get("expected_facts", ())),
            allowed_facts=tuple(_fact(f) for f in raw.get("allowed_facts", ())),
            evidence=tuple(raw.get("evidence", ())),
            variant_of=raw.get("variant_of"),
            notes=raw.get("notes"),
        )
        for raw in data["items"]
    )
    procedures = {name: list(value["anchors"]) for name, value in data["procedures"].items()}
    return AnswerKey(version=data["version"], hash=file_hash, procedures=procedures, items=items)


def load_answer_key(path=ANSWER_KEY_PATH):
    raw = Path(path).read_bytes()
    return parse_answer_key(json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest())


@lru_cache(maxsize=1)
def load_source_text():
    """Full text of the clinic brochure, page by page."""
    from pypdf import PdfReader

    from assistant.config import SOURCE_PDF

    return "\n".join(page.extract_text() for page in PdfReader(SOURCE_PDF).pages)


def validate(answer_key, source_text, check_coverage=True):
    """Applies the validation rules of the answer key. Returns the list of problems."""
    problems = []
    source = normalize_text(source_text)
    by_id = answer_key.by_id()

    for item_id, count in Counter(item.id for item in answer_key.items).items():
        if count > 1:
            problems.append(f"{item_id}: id repeated {count} times")

    for item in answer_key.items:
        if item.answerable:
            if not item.expected_facts:
                problems.append(f"{item.id}: an answerable question needs at least one expected fact")
            if not item.evidence:
                problems.append(f"{item.id}: an answerable question needs at least one evidence quote")
        elif item.expected_facts or item.evidence:
            problems.append(f"{item.id}: an unanswerable question cannot have expected facts or evidence")

        for evidence in item.evidence:
            occurrences = source.count(normalize_text(evidence))
            if occurrences != 1:
                problems.append(
                    f"{item.id}: the evidence \"{evidence}\" appears {occurrences} times in the brochure (must be 1)"
                )

        evidence_values = {v.key for evidence in item.evidence for v in extract_values(evidence)}
        for fact in item.expected_facts:
            for target in fact.targets():
                if target not in evidence_values:
                    problems.append(
                        f"{item.id}: the value {target[1]:g} of the fact \"{fact.label}\" is not in any evidence of the item"
                    )

        if item.procedure is not None and item.procedure not in answer_key.procedures:
            problems.append(f"{item.id}: procedure \"{item.procedure}\" does not exist in procedures")

        if item.variant_of is not None:
            original = by_id.get(item.variant_of)
            if original is None:
                problems.append(f"{item.id}: variant_of points to \"{item.variant_of}\", which does not exist")
            elif original.split != item.split:
                problems.append(f"{item.id}: variant_of points to an item of another split ({original.split})")

    if check_coverage:
        if len(answer_key.items) < MIN_ITEMS:
            problems.append(f"coverage: {len(answer_key.items)} items (minimum {MIN_ITEMS})")
        for procedure in answer_key.procedures:
            if procedure in NON_TREATMENT_PROCEDURES:
                continue
            categories = {item.category for item in answer_key.items if item.procedure == procedure}
            for category in REQUIRED_CATEGORIES_PER_PROCEDURE:
                if category not in categories:
                    problems.append(f"coverage: procedure \"{procedure}\" has no {category} item")
        unanswerable = sum(1 for item in answer_key.items if not item.answerable)
        if unanswerable < MIN_UNANSWERABLE:
            problems.append(f"coverage: {unanswerable} items with no answer in the brochure (minimum {MIN_UNANSWERABLE})")
        clinic_info = sum(1 for item in answer_key.items if item.category == "clinic_info")
        if clinic_info < MIN_CLINIC_INFO:
            problems.append(f"coverage: {clinic_info} clinic_info items (minimum {MIN_CLINIC_INFO})")

    return problems


def select_subset(answer_key, subset):
    """dev and holdout are the two splits; smoke is the small sample of dev."""
    if subset == "smoke":
        return [item for item in answer_key.items if item.smoke and item.split == "dev"]
    if subset in ("dev", "holdout"):
        return [item for item in answer_key.items if item.split == subset]
    raise ValueError(f"unknown subset: {subset}")


def coverage(answer_key):
    return {
        "total": len(answer_key.items),
        "unanswerable": sum(1 for item in answer_key.items if not item.answerable),
        "by_category": dict(Counter(item.category for item in answer_key.items)),
        "by_procedure": dict(Counter(item.procedure or "(general)" for item in answer_key.items)),
        "by_split": dict(Counter(item.split for item in answer_key.items)),
        "smoke": len(select_subset(answer_key, "smoke")),
    }
