"""Checking the judge against the evaluation of a person."""
import json
from pathlib import Path

from evaluation.judge import CRITERIA

PACKAGE_DIR = Path(__file__).parent
LABELS_PATH = PACKAGE_DIR / "data" / "human_labels.json"
AGREEMENT_PATH = PACKAGE_DIR / "data" / "judge_agreement.json"
MIN_AGREEMENT = 0.8


def build_sample(run, items_by_id, size=20):
    """Sample spread across question types, without the judge's verdicts and with the human fields empty."""
    by_category = {}
    for result in run["results"]:
        if result["judge"]:
            by_category.setdefault(items_by_id[result["item_id"]].category, []).append(result)

    picked = []
    while len(picked) < size and any(by_category.values()):
        for results in by_category.values():
            if results and len(picked) < size:
                picked.append(results.pop(0))

    return {
        "run_id": run["run_id"],
        "instructions": "Fill each criterion under \"human\" with true (meets it) or false (does not).",
        "criteria": {name: spec["rubric"] for name, spec in CRITERIA.items()},
        "samples": [
            {
                "item_id": result["item_id"],
                "question": items_by_id[result["item_id"]].question,
                "answer": result["answer"],
                "chunks": [chunk["content"] for chunk in result["retrieved"]["fused"]],
                "human": {criterion: None for criterion in CRITERIA},
            }
            for result in picked
        ],
    }


def export_sample(run, items_by_id, size=20, path=LABELS_PATH):
    sample = build_sample(run, items_by_id, size)
    Path(path).write_text(json.dumps(sample, ensure_ascii=False, indent=2), encoding="utf-8")
    return sample


def score_agreement(labels, run):
    """Agreement between the person and the judge, per criterion. Fields left empty are ignored."""
    judged = {result["item_id"]: result["judge"] for result in run["results"] if result["judge"]}
    criteria = {}
    for criterion in CRITERIA:
        compared = matches = unfilled = 0
        for sample in labels["samples"]:
            human = sample["human"].get(criterion)
            verdict = (judged.get(sample["item_id"]) or {}).get(criterion, {}).get("verdict")
            if not isinstance(human, bool):
                unfilled += 1
            elif verdict is not None:
                compared += 1
                matches += human == verdict
        agreement = matches / compared if compared else None
        criteria[criterion] = {
            "agreement": agreement,
            "compared": compared,
            "unfilled": unfilled,
            "reliable": agreement is not None and agreement >= MIN_AGREEMENT,
        }
    return {"run_id": run["run_id"], "judge_model": run["config"]["judge_model"], "criteria": criteria}


def save_agreement(agreement, path=AGREEMENT_PATH):
    Path(path).write_text(json.dumps(agreement, ensure_ascii=False, indent=2), encoding="utf-8")


def load_agreement(judge_model, path=AGREEMENT_PATH):
    """Agreement per criterion for the given judge model; {} if it has not been checked."""
    path = Path(path)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("judge_model") != judge_model:
        return {}
    return {name: entry["agreement"] for name, entry in data["criteria"].items()}
