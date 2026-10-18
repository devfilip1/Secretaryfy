"""Aggregated metrics of a run and variation across repetitions."""
import math

from evaluation.diagnose import CAUSES
from evaluation.retrieval_metrics import SOURCES

RETRIEVAL_METRICS = ("hit_rate", "recall", "mrr", "context_precision", "anchored_rate")


def _mean(values):
    values = list(values)
    return sum(values) / len(values) if values else None


def _percentile(values, fraction):
    """Percentile by the nearest-rank method."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def aggregate(results, items_by_id, human_agreement=None):
    """results: list of per-question results. A metric with no items to compute from is None."""
    pairs = [(items_by_id[result["item_id"]], result) for result in results]
    answerable = [(item, result) for item, result in pairs if item.answerable]
    unanswerable = [(item, result) for item, result in pairs if not item.answerable]

    retrieval = {}
    for source in SOURCES:
        scores = [(item, result["retrieval"][source]) for item, result in answerable if result["retrieval"]]
        retrieval[source] = {
            "hit_rate": _mean(score["hit"] for _, score in scores),
            "recall": _mean(score["recall"] for _, score in scores),
            "mrr": _mean(score["mrr"] for _, score in scores),
            "context_precision": _mean(score["context_precision"] for _, score in scores),
            "anchored_rate": _mean(score["anchored"] for item, score in scores if item.procedure),
        }

    answer = {
        "factual_accuracy": _mean(
            all(fact["found"] for fact in result["facts"]) and not result["unexpected_values"]
            for _, result in answerable
        ),
        "faithfulness_numeric": _mean(not result["ungrounded_values"] for _, result in pairs),
        "correct_refusal_rate": _mean(
            result["abstained"] and not result["unexpected_values"] for _, result in unanswerable
        ),
        "wrong_refusal_rate": _mean(
            result["abstained"] and not all(fact["found"] for fact in result["facts"]) for _, result in answerable
        ),
        "rule_compliance": _mean(not result["rule_violations"] for _, result in pairs),
    }

    judge = None
    judged = [result["judge"] for _, result in pairs if result["judge"]]
    if judged:
        judge = {}
        for criterion in judged[0]:
            verdicts = [j[criterion]["verdict"] for j in judged if j[criterion]["verdict"] is not None]
            judge[criterion] = {
                "score": _mean(verdicts),
                "human_agreement": (human_agreement or {}).get(criterion),
            }

    by_cause = {cause: 0 for cause in CAUSES}
    for _, result in pairs:
        if result["cause"]:
            by_cause[result["cause"]] += 1

    def pass_rate_by(key):
        groups = {}
        for item, result in pairs:
            groups.setdefault(key(item), []).append(result["passed"])
        return {name: _mean(passed) for name, passed in groups.items() if name is not None}

    latencies = [result["latency_s"] for _, result in pairs]
    return {
        "overall": {"pass_rate": _mean(result["passed"] for _, result in pairs), "item_count": len(pairs)},
        "retrieval": retrieval,
        "answer": answer,
        "judge": judge,
        "operational": {
            "latency_p50": _percentile(latencies, 0.5) or 0.0,
            "latency_p95": _percentile(latencies, 0.95) or 0.0,
        },
        "diagnosis": {
            "by_cause": by_cause,
            "by_category": pass_rate_by(lambda item: item.category),
            "by_procedure": pass_rate_by(lambda item: item.procedure),
        },
    }


def flatten(metrics):
    """Metrics comparable between runs, as {"retrieval.fused.hit_rate": 0.8, ...}."""
    flat = {"overall.pass_rate": metrics["overall"]["pass_rate"]}
    for source in SOURCES:
        for name in RETRIEVAL_METRICS:
            flat[f"retrieval.{source}.{name}"] = metrics["retrieval"][source][name]
    for name, value in metrics["answer"].items():
        flat[f"answer.{name}"] = value
    for criterion, value in (metrics.get("judge") or {}).items():
        flat[f"judge.{criterion}"] = value["score"]
    flat["operational.latency_p50"] = metrics["operational"]["latency_p50"]
    flat["operational.latency_p95"] = metrics["operational"]["latency_p95"]
    return flat


def variance(metric_sets):
    """Mean, minimum, and maximum of each metric across repetitions (list of aggregated metrics)."""
    flats = [flatten(metrics) for metrics in metric_sets]
    summary = {}
    for name in flats[0]:
        values = [flat[name] for flat in flats if flat.get(name) is not None]
        if values:
            summary[name] = {"mean": sum(values) / len(values), "min": min(values), "max": max(values)}
    return summary
