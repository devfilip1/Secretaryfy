"""Running the evaluation: asks the assistant item by item and builds the result of each question."""
from dataclasses import asdict, replace

from evaluation.answer_metrics import (
    check_facts,
    check_rules,
    detect_abstention,
    unexpected_values,
    ungrounded_values,
)
from evaluation.diagnose import classify
from evaluation.normalize import extract_values
from evaluation.retrieval_metrics import SOURCES, score_all_sources

# Generation parameters of the evaluation, so the same question gets the same answer.
EVAL_TEMPERATURE = 0
EVAL_SEED = 42


class FactIndex:
    """Facts of the answer key grouped, to know what an answer may mention without it being an error."""

    def __init__(self, answer_key):
        self.by_procedure = {}
        self.general = []  # what sets the clinic apart is valid for any question
        for item in answer_key.items:
            facts = [*item.expected_facts, *item.allowed_facts]
            if item.procedure:
                self.by_procedure.setdefault(item.procedure, []).extend(facts)
            elif item.category == "differentials":
                self.general.extend(facts)

    def known_for(self, item):
        return [*item.expected_facts, *item.allowed_facts, *self.by_procedure.get(item.procedure, []), *self.general]

    def other_procedure_targets(self, procedure):
        return {
            target
            for name, facts in self.by_procedure.items() if name != procedure
            for fact in facts for target in fact.targets()
        }


def eval_config(config):
    return replace(config, temperature=EVAL_TEMPERATURE, seed=EVAL_SEED)


def evaluate_item(item, answer_result, answer_key, index, judge_fn=None):
    """Builds the per-question result of the run record from the assistant's answer."""
    answer = answer_result.answer
    retrieved = {
        source: [asdict(chunk) for chunk in getattr(answer_result.retrieval, source)] for source in SOURCES
    }
    fused_texts = [chunk["content"] for chunk in retrieved["fused"]]

    facts = check_facts(answer, item.expected_facts)
    if item.answerable:
        known = index.known_for(item)
        # with a procedure, every value is checked; without one, only the kinds the question asks for
        kinds = None if item.procedure else {fact.type for fact in item.expected_facts if fact.type != "text"}
        unexpected = unexpected_values(answer, known, kinds)
    else:
        known = []
        unexpected = unexpected_values(answer, [])

    known_targets = {target for fact in known for target in fact.targets()}
    foreign = index.other_procedure_targets(item.procedure)
    other_procedure = [
        value.label for value in extract_values(answer)
        if value.label in unexpected and value.key not in known_targets and value.key in foreign
    ]

    abstained = detect_abstention(answer)
    violations = check_rules(answer)
    if item.answerable:
        passed = all(fact["found"] for fact in facts) and not unexpected and not violations
    else:
        passed = abstained and not unexpected and not violations

    result = {
        "item_id": item.id,
        "answer": answer,
        "retrieved": retrieved,
        "retrieval": score_all_sources(item, retrieved, answer_key),
        "facts": facts,
        "unexpected_values": unexpected,
        "ungrounded_values": ungrounded_values(answer, fused_texts),
        "abstained": abstained,
        "rule_violations": violations,
        "judge": None,
        "latency_s": round(answer_result.latency_s, 3),
        "passed": passed,
        "cause": None,
        "flags": [],
    }
    result["cause"], result["flags"] = classify(item, result, other_procedure)
    if judge_fn is not None:
        result["judge"] = judge_fn(item.question, answer, fused_texts)
    return result


def run_evaluation(items, answer_key, config, judge_fn=None, repeat=1, on_progress=None, answer_fn=None):
    """Runs the set `repeat` times. The judge only evaluates the first repetition.

    Returns status ("complete" or "incomplete"), repetitions (one list of results per repetition),
    skipped (ids not evaluated), and error (message, when incomplete).
    """
    if answer_fn is None:
        from assistant.pipeline import answer as answer_fn

    index = FactIndex(answer_key)
    repetitions = []
    try:
        for repetition in range(repeat):
            results = []
            repetitions.append(results)
            for item in items:
                answer_result = answer_fn(item.question, config)
                judge = judge_fn if repetition == 0 else None
                results.append(evaluate_item(item, answer_result, answer_key, index, judge))
                if on_progress:
                    on_progress()
    except (Exception, KeyboardInterrupt) as error:
        done = {result["item_id"] for result in repetitions[0]}
        return {
            "status": "incomplete",
            "repetitions": repetitions,
            "skipped": [item.id for item in items if item.id not in done],
            "error": f"{type(error).__name__}: {error}" if str(error) else type(error).__name__,
        }
    return {"status": "complete", "repetitions": repetitions, "skipped": [], "error": None}


def warm_up(config, answer_fn=None):
    """Loads the models before measuring, so the first question does not carry the load time."""
    if answer_fn is None:
        from assistant.pipeline import answer as answer_fn
    answer_fn("Hello", config)


def preflight(models, host):
    """Checks whether Ollama answers and whether the models are installed. Returns the list of problems."""
    import ollama

    try:
        installed = {model.model for model in ollama.Client(host=host).list().models}
    except Exception as error:
        return [f"Ollama did not answer at {host} ({type(error).__name__}). Is it running?"]

    installed |= {name.removesuffix(":latest") for name in installed}
    return [
        f"model \"{model}\" is not installed (run: ollama pull {model})"
        for model in dict.fromkeys(models) if model not in installed
    ]
