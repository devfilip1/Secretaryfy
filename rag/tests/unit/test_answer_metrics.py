import json
from pathlib import Path

import pytest

from evaluation.answer_metrics import (
    MAX_ANSWER_CHARS,
    check_facts,
    check_rules,
    detect_abstention,
    factual_ok,
    unexpected_values,
    ungrounded_values,
)
from evaluation.dataset import Fact

EXAMPLES = json.loads((Path(__file__).parents[1] / "fixtures" / "factual_examples.json").read_text(encoding="utf-8"))


def _facts(raw):
    return [
        Fact(f["type"], f["label"], tuple(f.get("values", ())), f.get("unit"), tuple(f.get("alternatives", ())))
        for f in raw
    ]


def test_fixture_covers_money_durations_times_and_text():
    assert len(EXAMPLES) == 24
    assert {fact["type"] for example in EXAMPLES for fact in example["expected_facts"]} == {"money", "duration", "time", "text"}


@pytest.mark.parametrize("example", EXAMPLES, ids=[e["name"] for e in EXAMPLES])
def test_factual_examples(example):
    verdict = factual_ok(
        example["answer"], _facts(example["expected_facts"]), _facts(example.get("allowed_facts", []))
    )

    assert verdict is example["expected_verdict"]


def test_check_facts_reports_each_fact():
    facts = _facts([
        {"type": "money", "label": "initial cost", "values": [180, 450]},
        {"type": "money", "label": "monthly", "values": [35, 90]},
    ])

    assert check_facts("The initial cost is $180–$450.", facts) == [
        {"label": "initial cost", "found": True},
        {"label": "monthly", "found": False},
    ]


def test_unexpected_values_respects_kinds():
    known = _facts([{"type": "money", "label": "price", "values": [900, 2000]}])
    answer = "A dental implant costs $900–$2,000 and requires 2 to 3 appointments."

    assert unexpected_values(answer, known, kinds={"money"}) == []
    assert unexpected_values(answer, known) == ["2 appointments", "3 appointments"]


def test_a_wrong_clock_time_is_unexpected():
    known = _facts([{"type": "time", "label": "Saturday hours", "values": [540, 840]}])

    assert unexpected_values("We open at 9:00 AM and close at 2:00 PM.", known) == []
    assert unexpected_values("We open at 9:00 AM and close at 6:00 PM.", known) == ["6:00 PM"]


@pytest.mark.parametrize(
    "answer",
    [
        "I don't have that information right now.",
        "I don’t have that information right now. I can help you with our treatments.",
        "i do not have that information",
        "Unfortunately I COULDN'T FIND that. Can I help with anything else?",
        "Dentures are not mentioned among our procedures.",
        "I'm not able to help with that.",
    ],
)
def test_detect_abstention(answer):
    assert detect_abstention(answer)


def test_normal_answer_is_not_abstention():
    assert not detect_abstention("Teeth whitening costs $180–$450. Shall we schedule your assessment?")


# --- numeric faithfulness ---

CHUNKS = ["Teeth Whitening\nPrice: $180–$450\nDuration: Full treatment: up to 14 days\nHOURS\nSaturday: 9:00 AM–2:00 PM"]


def test_values_present_in_chunks_are_grounded():
    assert ungrounded_values("It costs $180–$450.", CHUNKS) == []


def test_value_absent_from_chunks_is_ungrounded():
    assert ungrounded_values("It costs $180, and with the discount it is $149.", CHUNKS) == ["$149"]


def test_same_value_in_another_format_is_grounded():
    assert ungrounded_values("It costs up to four hundred fifty dollars and takes 2 weeks. We open at 9 am.", CHUNKS) == []


# --- service rules ---

@pytest.mark.parametrize(
    "answer, violation",
    [
        ("In this context, it costs $180.", "forbidden_term:context"),
        ("According to the clinic, it costs $180.", "forbidden_term:according to"),
        ("Based on the DOCUMENT provided, it costs $180.", "forbidden_term:document"),
        ("I could not find it in the documents.", "forbidden_term:document"),
        ("Our brochure says it costs $180.", "forbidden_term:brochure"),
        ("That is not in my database.", "forbidden_term:database"),
        ("Our clinic information says we open at 9:00 AM.", "forbidden_term:provided information"),
    ],
)
def test_forbidden_terms(answer, violation):
    assert check_rules(answer) == [violation]


def test_similar_words_are_not_forbidden():
    assert check_rules("Bring your documentation and visit the clinic; I can give you more information.") == []


def test_too_long_answer():
    assert "too_long" in check_rules("Teeth whitening is great for you. " * (MAX_ANSWER_CHARS // 30 + 2))


def test_answer_in_portuguese():
    assert check_rules("O clareamento é a melhor opção para você e para o seu sorriso.") == ["not_english"]


def test_clean_answer_has_no_violations():
    assert check_rules("Teeth whitening costs $180–$450. Shall we schedule your assessment?") == []
