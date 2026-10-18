"""Comparison between two runs."""
from evaluation.aggregate import flatten

# Small slack for floating-point differences.
EPSILON = 1e-9


def _spread(run, name):
    entry = (run.get("variance") or {}).get(name)
    return entry["max"] - entry["min"] if entry else None


def compare(base, candidate):
    """Returns the comparison between two runs. Different subsets are not comparable."""
    comparison = {
        "base": base["run_id"],
        "candidate": candidate["run_id"],
        "comparable": True,
        "reason": None,
        "warnings": [],
        "metric_deltas": {},
        "regressions": [],
        "improvements": [],
        "config_changes": {},
        "within_noise": {},
    }
    if base["subset"] != candidate["subset"]:
        comparison["comparable"] = False
        comparison["reason"] = (
            f"different subsets: {base['run_id']} is {base['subset']} and "
            f"{candidate['run_id']} is {candidate['subset']}"
        )
        return comparison

    base_results = {result["item_id"]: result for result in base["results"]}
    candidate_results = {result["item_id"]: result for result in candidate["results"]}
    common = [item_id for item_id in base_results if item_id in candidate_results]

    if base["answer_key_hash"] != candidate["answer_key_hash"]:
        left_out = len(set(base_results) ^ set(candidate_results))
        comparison["warnings"].append(
            f"the answer key changed between the runs ({base['answer_key_version']} → "
            f"{candidate['answer_key_version']}): the metrics are not directly comparable; "
            f"the per-question comparison uses the {len(common)} items in common and leaves {left_out} out"
        )

    base_flat = flatten(base["metrics"])
    candidate_flat = flatten(candidate["metrics"])
    for name in base_flat:
        before, after = base_flat[name], candidate_flat.get(name)
        delta = after - before if before is not None and after is not None else None
        comparison["metric_deltas"][name] = {"base": before, "candidate": after, "delta": delta}

        spreads = [s for s in (_spread(base, name), _spread(candidate, name)) if s is not None]
        if delta is None or not spreads:
            comparison["within_noise"][name] = None
        else:
            comparison["within_noise"][name] = abs(delta) <= max(spreads) + EPSILON

    for item_id in common:
        before, after = base_results[item_id], candidate_results[item_id]
        if before["passed"] and not after["passed"]:
            comparison["regressions"].append({"item_id": item_id, "cause": after.get("cause")})
        elif not before["passed"] and after["passed"]:
            comparison["improvements"].append({"item_id": item_id, "previous_cause": before.get("cause")})

    for field, before in base["config"].items():
        after = candidate["config"].get(field)
        if before != after and field not in ("git_commit", "git_dirty"):
            comparison["config_changes"][field] = {"base": before, "candidate": after}

    return comparison
