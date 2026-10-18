import pytest

from evaluation.aggregate import aggregate
from evaluation.dataset import Fact, AnswerKey, Item

ITEMS = (
    Item(id="whitening-price-01", question="How much is teeth whitening?", category="price",
         procedure="whitening", answerable=True, split="dev", smoke=True,
         expected_facts=(Fact("money", "price", (180, 450)),), evidence=("Price: $180–$450",)),
    Item(id="cleaning-price-01", question="How much is a dental cleaning?", category="price",
         procedure="cleaning", answerable=True, split="dev", smoke=False,
         expected_facts=(Fact("money", "price", (40, 85)),), evidence=("Price: $40–$85",)),
    Item(id="cleaning-duration-01", question="How long does a dental cleaning take?", category="duration",
         procedure="cleaning", answerable=True, split="holdout", smoke=False,
         expected_facts=(Fact("duration", "duration", (30, 50), "minute"),), evidence=("Duration: 30–50 minutes",)),
    Item(id="diff-appointment-01", question="How soon can I get an appointment?", category="differentials",
         procedure=None, answerable=True, split="dev", smoke=False,
         expected_facts=(Fact("duration", "wait", (72,), "hour"),), evidence=("Fast appointments (within 72 hours)",)),
    Item(id="out-insurance-01", question="Do you accept dental insurance?", category="out_of_scope",
         procedure=None, answerable=False, split="dev", smoke=False),
)


@pytest.fixture
def answer_key():
    return AnswerKey(
        version="test", hash="test-hash",
        procedures={"whitening": ["Teeth Whitening"], "cleaning": ["Dental Cleaning"]},
        items=ITEMS,
    )


@pytest.fixture
def make_result(answer_key):
    """Per-question result, in the format of run.schema.json."""
    items = answer_key.by_id()

    def factory(item_id, passed=True, cause=None, hit=True, latency=1.0, abstained=None, judge=None,
                unexpected=(), ungrounded=(), violations=()):
        item = items[item_id]
        if not passed and cause is None:
            cause = "answer_failure" if item.answerable else "fabricated"
        score = {"hit": hit, "recall": float(hit), "mrr": float(hit), "context_precision": 0.5 if hit else 0.0,
                 "anchored": hit}
        chunk = {"content": "chunk", "rank": 1, "score": 0.5}
        return {
            "item_id": item_id,
            "answer": "answer",
            "retrieved": {"vector": [chunk], "bm25": [chunk], "fused": [chunk]},
            "retrieval": {"vector": dict(score), "bm25": dict(score), "fused": dict(score)} if item.answerable else None,
            "facts": [{"label": fact.label, "found": passed} for fact in item.expected_facts],
            "unexpected_values": list(unexpected),
            "ungrounded_values": list(ungrounded),
            "abstained": (not item.answerable and passed) if abstained is None else abstained,
            "rule_violations": list(violations),
            "judge": judge,
            "latency_s": latency,
            "passed": passed,
            "cause": cause,
            "flags": [],
        }

    return factory


@pytest.fixture
def make_run(answer_key):
    """Complete run, in the format of run.schema.json."""

    def factory(run_id, results, subset="dev", status="complete", answer_key_hash="test-hash", variance=None,
                **config):
        run = {
            "run_id": run_id,
            "started_at": "2026-10-10T10:00:00-03:00",
            "finished_at": "2026-10-10T10:05:00-03:00",
            "status": status,
            "subset": subset,
            "answer_key_version": "test",
            "answer_key_hash": answer_key_hash,
            "config": {
                "chunk_size": 500, "chunk_overlap": 200, "vector_k": 3, "bm25_k": 3, "chat_model": "llama3",
                "embedding_model": "nomic-embed-text", "temperature": 0, "seed": 42, "num_ctx": None,
                "prompt_hash": "p", "kb_hash": "k", "kb_chunk_count": 11, "judge_model": None,
                "git_commit": "abc1234", "git_dirty": False, **config,
            },
            "repeat": 1,
            "results": results,
            "metrics": aggregate(results, answer_key.by_id()),
            "skipped": [],
        }
        if variance:
            run["variance"] = variance
        return run

    return factory
