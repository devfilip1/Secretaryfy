import pytest

from evaluation.aggregate import aggregate, flatten, variance

DEV = ["whitening-price-01", "cleaning-price-01", "diff-appointment-01", "out-insurance-01"]


def test_overall_and_answer_metrics(answer_key, make_result):
    results = [
        make_result("whitening-price-01", passed=False, unexpected=["$40"]),
        make_result("cleaning-price-01"),
        make_result("diff-appointment-01", passed=False, cause="wrong_refusal", abstained=True),
        make_result("out-insurance-01", passed=False, ungrounded=["$99"], unexpected=["$99"]),
    ]

    metrics = aggregate(results, answer_key.by_id())

    assert metrics["overall"] == {"pass_rate": 0.25, "item_count": 4}
    assert metrics["answer"]["factual_accuracy"] == pytest.approx(1 / 3)
    assert metrics["answer"]["wrong_refusal_rate"] == pytest.approx(1 / 3)
    assert metrics["answer"]["correct_refusal_rate"] == 0.0
    assert metrics["answer"]["faithfulness_numeric"] == 0.75
    assert metrics["answer"]["rule_compliance"] == 1.0
    assert metrics["diagnosis"]["by_cause"] == {
        "retrieval_failure": 0, "answer_failure": 1, "fabricated": 1, "wrong_refusal": 1, "rule_violation": 0,
    }
    assert metrics["diagnosis"]["by_category"] == {"price": 0.5, "differentials": 0.0, "out_of_scope": 0.0}
    assert metrics["diagnosis"]["by_procedure"] == {"whitening": 0.0, "cleaning": 1.0}


def test_retrieval_metrics_use_only_answerable_items(answer_key, make_result):
    results = [
        make_result("whitening-price-01", passed=False, cause="retrieval_failure", hit=False),
        make_result("cleaning-price-01"),
        make_result("out-insurance-01"),
    ]

    fused = aggregate(results, answer_key.by_id())["retrieval"]["fused"]

    assert fused["hit_rate"] == 0.5
    assert fused["mrr"] == 0.5
    assert fused["context_precision"] == 0.25


def test_anchored_rate_ignores_items_without_procedure(answer_key, make_result):
    results = [make_result("cleaning-price-01"), make_result("diff-appointment-01", hit=False, passed=False)]

    assert aggregate(results, answer_key.by_id())["retrieval"]["fused"]["anchored_rate"] == 1.0


def test_metric_without_items_is_none(answer_key, make_result):
    metrics = aggregate([make_result("out-insurance-01")], answer_key.by_id())

    assert metrics["answer"]["factual_accuracy"] is None
    assert metrics["retrieval"]["fused"]["hit_rate"] is None
    assert metrics["answer"]["correct_refusal_rate"] == 1.0
    assert metrics["judge"] is None


def test_empty_run_does_not_fail(answer_key):
    metrics = aggregate([], answer_key.by_id())

    assert metrics["overall"] == {"pass_rate": None, "item_count": 0}
    assert metrics["operational"] == {"latency_p50": 0.0, "latency_p95": 0.0}


def test_latency_percentiles(answer_key, make_result):
    results = [make_result(item_id, latency=latency) for item_id, latency in zip(DEV, [1.0, 2.0, 3.0, 10.0])]

    assert aggregate(results, answer_key.by_id())["operational"] == {"latency_p50": 2.0, "latency_p95": 10.0}


def test_judge_scores_ignore_null_verdicts_and_carry_human_agreement(answer_key, make_result):
    def verdicts(tone):
        return {"tone": {"verdict": tone, "reason": ""}, "scheduling": {"verdict": True, "reason": ""}}

    results = [
        make_result("whitening-price-01", judge=verdicts(True)),
        make_result("cleaning-price-01", judge=verdicts(False)),
        make_result("out-insurance-01", judge=verdicts(None)),
    ]

    judge = aggregate(results, answer_key.by_id(), human_agreement={"tone": 0.9})["judge"]

    assert judge["tone"] == {"score": 0.5, "human_agreement": 0.9}
    assert judge["scheduling"] == {"score": 1.0, "human_agreement": None}


def test_variance_reports_mean_min_and_max(answer_key, make_result):
    first = aggregate([make_result("whitening-price-01"), make_result("cleaning-price-01")], answer_key.by_id())
    second = aggregate(
        [make_result("whitening-price-01", passed=False), make_result("cleaning-price-01")], answer_key.by_id()
    )

    summary = variance([first, second])

    assert summary["overall.pass_rate"] == {"mean": 0.75, "min": 0.5, "max": 1.0}
    assert summary["retrieval.fused.hit_rate"] == {"mean": 1.0, "min": 1.0, "max": 1.0}
    assert "answer.correct_refusal_rate" not in summary


def test_flatten_names(answer_key, make_result):
    flat = flatten(aggregate([make_result("cleaning-price-01")], answer_key.by_id()))

    assert flat["overall.pass_rate"] == 1.0
    assert "retrieval.vector.mrr" in flat
    assert "answer.rule_compliance" in flat
    assert "operational.latency_p95" in flat
