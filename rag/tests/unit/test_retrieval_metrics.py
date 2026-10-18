import pytest

from evaluation.dataset import Fact, Item
from evaluation.retrieval_metrics import score_retrieval

PRICE = "Price: $180–$450"
TIME = "Duration: In-office: same day | Full treatment: up to 14 days"

HEADING = "Teeth Whitening — Whiter Teeth in Just a Few Days\nIdeal for people who want to:"
WITH_PRICE = "How it works: Professional whitening gel\nunder supervision.\nPrice: $180–$450"
ANCHORED = HEADING + "\n" + WITH_PRICE
OTHER = "Dental Cleaning\nPrice: $40–$85"
ANCHORS = ["Teeth Whitening"]


def item(evidence=(PRICE,), answerable=True):
    return Item(
        id="x", question="?", category="price", procedure="whitening", answerable=answerable,
        split="dev", smoke=False,
        expected_facts=(Fact("money", "price", (180, 450)),) if answerable else (),
        evidence=evidence if answerable else (),
    )


def test_evidence_in_first_chunk():
    score = score_retrieval(item(), [ANCHORED, OTHER, OTHER], ANCHORS)

    assert score == {"hit": True, "recall": 1.0, "mrr": 1.0, "context_precision": pytest.approx(1 / 3), "anchored": True}


def test_evidence_in_third_chunk():
    score = score_retrieval(item(), [OTHER, HEADING, ANCHORED], ANCHORS)

    assert score["hit"] is True
    assert score["mrr"] == pytest.approx(1 / 3)


def test_evidence_not_retrieved():
    score = score_retrieval(item(), [OTHER, HEADING], ANCHORS)

    assert score == {"hit": False, "recall": 0.0, "mrr": 0.0, "context_precision": 0.0, "anchored": False}


def test_recall_with_two_evidences_and_one_retrieved():
    score = score_retrieval(item(evidence=(PRICE, TIME)), [ANCHORED, OTHER], ANCHORS)

    assert score["hit"] is True
    assert score["recall"] == 0.5


def test_context_precision_one_relevant_in_four():
    score = score_retrieval(item(), [OTHER, ANCHORED, HEADING, OTHER], ANCHORS)

    assert score["context_precision"] == 0.25
    assert score["mrr"] == 0.5


def test_matching_ignores_case_dash_style_and_line_breaks():
    chunk = "TEETH WHITENING\nprice:\n$180-$450"

    assert score_retrieval(item(), [chunk], ["teeth whitening"])["hit"] is True
    assert score_retrieval(item(evidence=("duration: IN-OFFICE: same day | full treatment: up to 14 days",)), [TIME], [])["hit"]


def test_evidence_retrieved_without_the_procedure_name_is_not_anchored():
    score = score_retrieval(item(), [WITH_PRICE, HEADING], ANCHORS)

    assert score["hit"] is True
    assert score["anchored"] is False


def test_anchor_in_a_different_chunk_does_not_count():
    assert score_retrieval(item(), [HEADING, WITH_PRICE], ANCHORS)["anchored"] is False


def test_item_without_anchors_is_anchored_when_hit():
    assert score_retrieval(item(), [WITH_PRICE], [])["anchored"] is True


def test_unanswerable_item_has_no_retrieval_score():
    assert score_retrieval(item(answerable=False), [ANCHORED], ANCHORS) is None


def test_no_chunks_retrieved():
    assert score_retrieval(item(), [], ANCHORS)["context_precision"] == 0.0
