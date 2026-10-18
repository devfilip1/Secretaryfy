from evaluation.dataset import Fact, Item
from evaluation.diagnose import classify

ANSWERABLE = Item(
    id="whitening-price-01", question="?", category="price", procedure="whitening", answerable=True,
    split="dev", smoke=False, expected_facts=(Fact("money", "price", (180, 450)),),
    evidence=("Price: $180–$450",),
)
UNANSWERABLE = Item(
    id="out-insurance-01", question="?", category="out_of_scope", procedure=None, answerable=False,
    split="dev", smoke=False,
)


def result(passed=False, hit=True, anchored=True, found=True, unexpected=(), ungrounded=(), abstained=False,
           violations=(), answerable=True):
    retrieval = {"fused": {"hit": hit, "recall": float(hit), "mrr": float(hit), "context_precision": 0.5,
                           "anchored": anchored and hit}} if answerable else None
    return {
        "passed": passed,
        "retrieval": retrieval,
        "facts": [{"label": "price", "found": found}] if answerable else [],
        "unexpected_values": list(unexpected),
        "ungrounded_values": list(ungrounded),
        "abstained": abstained,
        "rule_violations": list(violations),
    }


def test_passed_item_has_no_cause():
    assert classify(ANSWERABLE, result(passed=True)) == (None, [])


def test_unanswerable_question_that_was_answered_is_fabricated():
    assert classify(UNANSWERABLE, result(answerable=False))[0] == "fabricated"


def test_unanswerable_question_refused_but_with_values_is_fabricated():
    outcome = result(answerable=False, abstained=True, unexpected=["$180"])

    assert classify(UNANSWERABLE, outcome)[0] == "fabricated"


def test_evidence_not_retrieved_is_retrieval_failure():
    assert classify(ANSWERABLE, result(hit=False, found=False))[0] == "retrieval_failure"


def test_retrieval_failure_wins_over_refusal_and_fabrication():
    outcome = result(hit=False, found=False, abstained=True, ungrounded=["$99"], unexpected=["$99"])

    assert classify(ANSWERABLE, outcome)[0] == "retrieval_failure"


def test_evidence_retrieved_and_refused_is_wrong_refusal():
    assert classify(ANSWERABLE, result(found=False, abstained=True))[0] == "wrong_refusal"


def test_evidence_retrieved_and_value_outside_chunks_is_fabricated():
    outcome = result(found=False, unexpected=["$99"], ungrounded=["$99"])

    assert classify(ANSWERABLE, outcome)[0] == "fabricated"


def test_evidence_retrieved_and_wrong_fact_is_answer_failure():
    assert classify(ANSWERABLE, result(found=False, unexpected=["$40", "$85"]))[0] == "answer_failure"


def test_evidence_retrieved_and_missing_fact_is_answer_failure():
    assert classify(ANSWERABLE, result(found=False))[0] == "answer_failure"


def test_flag_evidence_not_anchored():
    cause, flags = classify(ANSWERABLE, result(found=False, anchored=False))

    assert cause == "answer_failure"
    assert flags == ["evidence_not_anchored"]


def test_flag_other_procedure_value():
    outcome = result(found=False, unexpected=["$40", "$85"])

    assert classify(ANSWERABLE, outcome, other_procedure_labels=["$40", "$85"])[1] == ["other_procedure_value"]


def test_flags_are_reported_even_when_the_item_passed():
    assert classify(ANSWERABLE, result(passed=True, anchored=False)) == (None, ["evidence_not_anchored"])


# --- service rules ---

def test_right_facts_with_rule_violation_is_rule_violation():
    assert classify(ANSWERABLE, result(violations=["forbidden_term:context"]))[0] == "rule_violation"


def test_wrong_facts_with_rule_violation_keeps_the_higher_cause():
    outcome = result(found=False, violations=["forbidden_term:context"])

    assert classify(ANSWERABLE, outcome)[0] == "answer_failure"


def test_correct_refusal_with_rule_violation_is_rule_violation():
    outcome = result(answerable=False, abstained=True, violations=["forbidden_term:context"])

    assert classify(UNANSWERABLE, outcome)[0] == "rule_violation"
