"""Main cause of each wrong answer."""

CAUSES = ("retrieval_failure", "answer_failure", "fabricated", "wrong_refusal", "rule_violation")


def classify(item, result, other_procedure_labels=()):
    """Returns (cause, flags). The cause is None when the item passed.

    result: dict with passed, retrieval, facts, unexpected_values, ungrounded_values, abstained, rule_violations.
    other_procedure_labels: unexpected values that are a fact of another procedure.
    """
    flags = []
    fused = (result.get("retrieval") or {}).get("fused")
    if fused and fused["hit"] and not fused["anchored"]:
        flags.append("evidence_not_anchored")
    if other_procedure_labels:
        flags.append("other_procedure_value")

    if result["passed"]:
        return None, flags

    facts_ok = all(fact["found"] for fact in result["facts"]) and not result["unexpected_values"]

    if not item.answerable:
        cause = "fabricated" if not result["abstained"] or result["unexpected_values"] else "rule_violation"
    elif not fused["hit"]:
        cause = "retrieval_failure"
    elif result["abstained"] and not facts_ok:
        cause = "wrong_refusal"
    elif result["ungrounded_values"]:
        cause = "fabricated"
    elif not facts_ok:
        cause = "answer_failure"
    else:
        cause = "rule_violation"
    return cause, flags
