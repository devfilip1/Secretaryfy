from dataclasses import dataclass
from types import SimpleNamespace

from evaluation.runner import FactIndex, evaluate_item, run_evaluation

WHITENING = "Teeth Whitening\nPrice: $180–$450"
MIXED = "Dental Cleaning\nPrice: $40–$85\nTeeth Whitening — Whiter Teeth"
REFUSAL = "I don't have that information right now."


@dataclass
class Chunk:
    """Same shape as assistant.pipeline.RetrievedChunk, without importing the pipeline."""
    content: str
    rank: int
    score: float | None = None


def answer_result(text, chunks=(WHITENING,), latency=1.234):
    retrieved = [Chunk(content, rank, 0.5) for rank, content in enumerate(chunks, 1)]
    retrieval = SimpleNamespace(vector=retrieved, bm25=retrieved, fused=retrieved)
    return SimpleNamespace(answer=text, retrieval=retrieval, latency_s=latency)


def evaluate(answer_key, item_id, text, chunks=(WHITENING,), judge_fn=None):
    item = answer_key.by_id()[item_id]
    return evaluate_item(item, answer_result(text, chunks), answer_key, FactIndex(answer_key), judge_fn)


def test_right_answer_passes(answer_key):
    result = evaluate(answer_key, "whitening-price-01", "Teeth whitening costs $180–$450.")

    assert result["passed"] is True
    assert result["cause"] is None
    assert result["facts"] == [{"label": "price", "found": True}]
    assert result["retrieval"]["fused"]["hit"] is True
    assert result["latency_s"] == 1.234


def test_known_error_price_of_another_procedure(answer_key):
    result = evaluate(answer_key, "whitening-price-01", "Teeth whitening costs $40–$85.",
                      chunks=(MIXED, WHITENING))

    assert result["passed"] is False
    assert result["unexpected_values"] == ["$40", "$85"]
    assert result["cause"] == "answer_failure"
    assert result["flags"] == ["other_procedure_value"]


def test_right_value_plus_value_of_another_procedure_fails(answer_key):
    result = evaluate(answer_key, "whitening-price-01",
                      "It costs $180–$450. A cleaning goes for $40–$85.", chunks=(MIXED, WHITENING))

    assert result["passed"] is False
    assert result["facts"] == [{"label": "price", "found": True}]


def test_other_facts_of_the_same_procedure_are_allowed(answer_key):
    result = evaluate(answer_key, "cleaning-price-01", "A dental cleaning costs $40–$85 and takes 30 to 50 minutes.",
                      chunks=("Dental Cleaning\nDuration: 30–50 minutes\nPrice: $40–$85",))

    assert result["passed"] is True


def test_clinic_differentials_are_allowed_in_any_answer(answer_key):
    result = evaluate(answer_key, "whitening-price-01",
                      "It costs $180–$450 and you get an appointment within 72 hours.",
                      chunks=(WHITENING, "Fast appointments (within 72 hours)"))

    assert result["passed"] is True


def test_evidence_not_retrieved_is_retrieval_failure(answer_key):
    result = evaluate(answer_key, "whitening-price-01", REFUSAL, chunks=(MIXED,))

    assert result["passed"] is False
    assert result["abstained"] is True
    assert result["cause"] == "retrieval_failure"


def test_value_outside_the_chunks_is_fabricated(answer_key):
    result = evaluate(answer_key, "whitening-price-01", "Teeth whitening costs $149.")

    assert result["ungrounded_values"] == ["$149"]
    assert result["cause"] == "fabricated"


def test_unanswerable_question_refused_passes(answer_key):
    result = evaluate(answer_key, "out-insurance-01", REFUSAL)

    assert result["passed"] is True
    assert result["retrieval"] is None


def test_unanswerable_question_answered_is_fabricated(answer_key):
    result = evaluate(answer_key, "out-insurance-01", "Yes, we accept every dental plan.")

    assert result["passed"] is False
    assert result["cause"] == "fabricated"


def test_unanswerable_question_refused_with_a_value_fails(answer_key):
    result = evaluate(answer_key, "out-insurance-01", f"{REFUSAL} A cleaning costs $40–$85.")

    assert result["passed"] is False
    assert result["unexpected_values"] == ["$40", "$85"]


def test_rule_violation_fails_an_otherwise_right_answer(answer_key):
    result = evaluate(answer_key, "whitening-price-01", "In this context, it costs $180–$450.")

    assert result["passed"] is False
    assert result["rule_violations"] == ["forbidden_term:context"]
    assert result["cause"] == "rule_violation"


def test_answer_in_portuguese_fails_an_otherwise_right_answer(answer_key):
    result = evaluate(answer_key, "whitening-price-01", "O clareamento custa de $180 a $450 para você.")

    assert result["passed"] is False
    assert result["rule_violations"] == ["not_english"]


def test_judge_verdicts_are_stored_and_do_not_change_passed(answer_key):
    def judge(question, answer, chunks):
        return {"tone": {"verdict": False, "reason": "curt"}}

    result = evaluate(answer_key, "whitening-price-01", "It costs $180–$450.", judge_fn=judge)

    assert result["judge"] == {"tone": {"verdict": False, "reason": "curt"}}
    assert result["passed"] is True


def test_run_evaluation_complete_with_repetitions(answer_key):
    calls = []

    def answer_fn(question, config):
        calls.append(question)
        return answer_result(REFUSAL)

    progress = []
    outcome = run_evaluation(list(answer_key.items), answer_key, None, repeat=2,
                             on_progress=lambda: progress.append(1), answer_fn=answer_fn)

    assert outcome["status"] == "complete"
    assert outcome["skipped"] == []
    assert [len(results) for results in outcome["repetitions"]] == [5, 5]
    assert len(calls) == len(progress) == 10


def test_judge_runs_only_on_the_first_repetition(answer_key):
    judged = []

    def judge(question, answer, chunks):
        judged.append(question)
        return {"tone": {"verdict": True, "reason": ""}}

    run_evaluation(list(answer_key.items), answer_key, None, judge_fn=judge, repeat=2,
                   answer_fn=lambda question, config: answer_result(REFUSAL))

    assert len(judged) == 5


def test_service_failure_makes_the_run_incomplete(answer_key):
    def answer_fn(question, config):
        if question.startswith("How long"):
            raise ConnectionError("Ollama is down")
        return answer_result(REFUSAL)

    outcome = run_evaluation(list(answer_key.items), answer_key, None, answer_fn=answer_fn)

    assert outcome["status"] == "incomplete"
    assert outcome["skipped"] == ["cleaning-duration-01", "diff-appointment-01", "out-insurance-01"]
    assert len(outcome["repetitions"][0]) == 2
    assert "Ollama is down" in outcome["error"]


def test_interruption_makes_the_run_incomplete(answer_key):
    def answer_fn(question, config):
        raise KeyboardInterrupt

    outcome = run_evaluation(list(answer_key.items), answer_key, None, answer_fn=answer_fn)

    assert outcome["status"] == "incomplete"
    assert len(outcome["skipped"]) == 5
