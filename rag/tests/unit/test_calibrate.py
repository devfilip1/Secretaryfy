import pytest

from evaluation.calibrate import build_sample, load_agreement, save_agreement, score_agreement
from evaluation.judge import CRITERIA, parse_verdict

IDS = ["whitening-price-01", "cleaning-price-01", "diff-appointment-01", "out-insurance-01"]


def verdicts(value=True, **overrides):
    return {name: {"verdict": overrides.get(name, value), "reason": "the reason of the judge"} for name in CRITERIA}


@pytest.fixture
def run(make_run, make_result):
    return make_run("20261010-100000", [make_result(item_id, judge=verdicts()) for item_id in IDS],
                    judge_model="llama3")


def test_sample_has_the_requested_size_and_is_spread_across_categories(run, answer_key):
    sample = build_sample(run, answer_key.by_id(), size=3)

    assert sample["run_id"] == "20261010-100000"
    assert [s["item_id"] for s in sample["samples"]] == ["whitening-price-01", "diff-appointment-01", "out-insurance-01"]


def test_sample_is_capped_by_the_judged_answers(run, answer_key):
    assert len(build_sample(run, answer_key.by_id(), size=20)["samples"]) == 4


def test_sample_hides_the_judge_and_leaves_human_fields_empty(run, answer_key):
    sample = build_sample(run, answer_key.by_id(), size=4)

    assert "the reason of the judge" not in str(sample)
    for entry in sample["samples"]:
        assert entry["human"] == {name: None for name in CRITERIA}
        assert entry["question"] and entry["answer"]


def test_answers_without_judge_are_not_sampled(make_run, make_result, answer_key):
    run = make_run("20261010-100000", [make_result("cleaning-price-01")])

    assert build_sample(run, answer_key.by_id())["samples"] == []


def test_agreement_per_criterion(run, answer_key):
    labels = build_sample(run, answer_key.by_id(), size=4)
    for index, entry in enumerate(labels["samples"]):
        entry["human"] = {name: True for name in CRITERIA}
        entry["human"]["tone"] = index != 0  # disagrees with the judge in 1 of 4

    agreement = score_agreement(labels, run)

    assert agreement["judge_model"] == "llama3"
    assert agreement["criteria"]["relevance"] == {"agreement": 1.0, "compared": 4, "unfilled": 0, "reliable": True}
    assert agreement["criteria"]["tone"] == {"agreement": 0.75, "compared": 4, "unfilled": 0, "reliable": False}


def test_unfilled_labels_are_ignored_and_counted(run, answer_key):
    labels = build_sample(run, answer_key.by_id(), size=4)
    labels["samples"][0]["human"]["tone"] = True

    agreement = score_agreement(labels, run)

    assert agreement["criteria"]["tone"] == {"agreement": 1.0, "compared": 1, "unfilled": 3, "reliable": True}
    assert agreement["criteria"]["relevance"] == {"agreement": None, "compared": 0, "unfilled": 4, "reliable": False}


def test_null_judge_verdict_is_not_compared(make_run, make_result, answer_key):
    run = make_run("20261010-100000", [make_result("cleaning-price-01", judge=verdicts(tone=None))],
                   judge_model="llama3")
    labels = build_sample(run, answer_key.by_id())
    labels["samples"][0]["human"] = {name: True for name in CRITERIA}

    assert score_agreement(labels, run)["criteria"]["tone"]["compared"] == 0


def test_saved_agreement_is_loaded_only_for_the_same_judge(tmp_path, run, answer_key):
    labels = build_sample(run, answer_key.by_id(), size=4)
    for entry in labels["samples"]:
        entry["human"] = {name: True for name in CRITERIA}
    path = tmp_path / "judge_agreement.json"
    save_agreement(score_agreement(labels, run), path)

    assert load_agreement("llama3", path)["tone"] == 1.0
    assert load_agreement("other-model", path) == {}
    assert load_agreement("llama3", tmp_path / "does-not-exist.json") == {}


@pytest.mark.parametrize(
    "content, verdict",
    [
        ('{"reason": "invites to schedule", "verdict": true}', True),
        ('{"reason": "does not invite", "verdict": false}', False),
        ("this is not json", None),
        ('{"reason": "no verdict"}', None),
        ('{"reason": "text", "verdict": "yes"}', None),
    ],
)
def test_parse_verdict(content, verdict):
    assert parse_verdict(content)["verdict"] is verdict
