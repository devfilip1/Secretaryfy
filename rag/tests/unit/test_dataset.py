import copy

import pytest

from evaluation.dataset import AnswerKeyError, coverage, parse_answer_key, select_subset, validate

SOURCE = """DentalSafe
HOURS
Saturday: 9:00 AM–2:00 PM
Dental Cleaning
Duration: 30–50 minutes   |   Price: $40–$85
Result: Immediate, from the very first session
Teeth Whitening
Price: $180–$450
Braces and Orthodontic Treatment
Initial cost: $180–$450   |   Monthly: $35–$90
"""

BASE = {
    "version": "test",
    "procedures": {
        "cleaning": {"anchors": ["Dental Cleaning"]},
        "whitening": {"anchors": ["Teeth Whitening"]},
        "clinic": {"anchors": ["HOURS"]},
    },
    "items": [
        {
            "id": "cleaning-price-01",
            "question": "How much is a dental cleaning?",
            "category": "price",
            "procedure": "cleaning",
            "answerable": True,
            "expected_facts": [{"type": "money", "label": "price", "values": [40, 85]}],
            "evidence": ["Price: $40–$85"],
            "split": "dev",
            "smoke": True,
        },
        {
            "id": "cleaning-duration-01",
            "question": "How long does a dental cleaning take?",
            "category": "duration",
            "procedure": "cleaning",
            "answerable": True,
            "expected_facts": [{"type": "duration", "label": "duration", "values": [30, 50], "unit": "minute"}],
            "evidence": ["Duration: 30–50 minutes"],
            "split": "holdout",
            "smoke": False,
        },
        {
            "id": "out-insurance-01",
            "question": "Do you accept dental insurance?",
            "category": "out_of_scope",
            "procedure": None,
            "answerable": False,
            "split": "dev",
            "smoke": False,
        },
        {
            "id": "clinic-hours-01",
            "question": "What are your hours on Saturday?",
            "category": "clinic_info",
            "procedure": "clinic",
            "answerable": True,
            "expected_facts": [{"type": "time", "label": "Saturday hours", "values": [540, 840]}],
            "evidence": ["Saturday: 9:00 AM–2:00 PM"],
            "split": "dev",
            "smoke": False,
        },
    ],
}


def problems_for(change, check_coverage=False):
    data = copy.deepcopy(BASE)
    change(data)
    return validate(parse_answer_key(data), SOURCE, check_coverage=check_coverage)


def test_valid_answer_key_has_no_problems():
    assert problems_for(lambda data: None) == []


def test_duplicate_id():
    problems = problems_for(lambda data: data["items"].append(copy.deepcopy(data["items"][0])))

    assert any("cleaning-price-01" in p and "repeated" in p for p in problems)


def test_schema_rejects_answerable_item_without_facts_or_evidence():
    data = copy.deepcopy(BASE)
    del data["items"][0]["expected_facts"]

    with pytest.raises(AnswerKeyError) as error:
        parse_answer_key(data)

    assert "expected_facts" in str(error.value)


def test_schema_rejects_unanswerable_item_with_evidence():
    data = copy.deepcopy(BASE)
    data["items"][2]["evidence"] = ["Price: $40–$85"]

    with pytest.raises(AnswerKeyError):
        parse_answer_key(data)


def test_schema_rejects_unknown_category():
    data = copy.deepcopy(BASE)
    data["items"][0]["category"] = "cost"

    with pytest.raises(AnswerKeyError):
        parse_answer_key(data)


def test_schema_rejects_a_clock_time_outside_the_day():
    data = copy.deepcopy(BASE)
    data["items"][3]["expected_facts"][0]["values"] = [540, 1500]

    with pytest.raises(AnswerKeyError):
        parse_answer_key(data)


def test_evidence_missing_from_source():
    def change(data):
        data["items"][0]["evidence"] = ["Price: $999"]
        data["items"][0]["expected_facts"][0]["values"] = [999]

    problems = problems_for(change)

    assert any("cleaning-price-01" in p and "appears 0 times" in p for p in problems)


def test_evidence_that_is_not_unique():
    def change(data):
        data["items"][0]["evidence"] = ["$180–$450"]
        data["items"][0]["expected_facts"][0]["values"] = [180, 450]

    problems = problems_for(change)

    assert any("cleaning-price-01" in p and "appears 2 times" in p for p in problems)


def test_evidence_matching_ignores_case_dash_style_and_line_breaks():
    problems = problems_for(
        lambda data: data["items"][0].update(evidence=["PRICE:   $40-$85\nresult: immediate"])
    )

    assert problems == []


def test_fact_value_missing_from_evidence():
    problems = problems_for(lambda data: data["items"][0]["expected_facts"][0].update(values=[40, 90]))

    assert any("cleaning-price-01" in p and "90" in p and "evidence" in p for p in problems)


def test_clock_time_missing_from_evidence():
    problems = problems_for(lambda data: data["items"][3]["expected_facts"][0].update(values=[540, 1080]))

    assert any("clinic-hours-01" in p and "1080" in p and "evidence" in p for p in problems)


def test_unknown_procedure():
    problems = problems_for(lambda data: data["items"][0].update(procedure="botox"))

    assert any("cleaning-price-01" in p and "botox" in p for p in problems)


def test_variant_of_missing_item():
    problems = problems_for(lambda data: data["items"][0].update(variant_of="does-not-exist"))

    assert any("cleaning-price-01" in p and "does-not-exist" in p for p in problems)


def test_variant_of_another_split():
    problems = problems_for(lambda data: data["items"][0].update(variant_of="cleaning-duration-01"))

    assert any("cleaning-price-01" in p and "another split" in p for p in problems)


def test_coverage_rules():
    problems = problems_for(lambda data: None, check_coverage=True)

    assert any("4 items (minimum 60)" in p for p in problems)
    assert any("\"cleaning\" has no result item" in p for p in problems)
    assert any("\"whitening\" has no price item" in p for p in problems)
    assert any("1 items with no answer in the brochure (minimum 6)" in p for p in problems)
    assert any("1 clinic_info items (minimum 8)" in p for p in problems)


def test_clinic_is_not_required_to_have_price_duration_and_result():
    problems = problems_for(lambda data: None, check_coverage=True)

    assert not any("\"clinic\"" in p for p in problems)


def test_select_subset():
    answer_key = parse_answer_key(BASE)

    assert [i.id for i in select_subset(answer_key, "dev")] == ["cleaning-price-01", "out-insurance-01", "clinic-hours-01"]
    assert [i.id for i in select_subset(answer_key, "holdout")] == ["cleaning-duration-01"]
    assert [i.id for i in select_subset(answer_key, "smoke")] == ["cleaning-price-01"]


def test_coverage_counts():
    summary = coverage(parse_answer_key(BASE))

    assert summary["total"] == 4
    assert summary["unanswerable"] == 1
    assert summary["by_split"] == {"dev": 3, "holdout": 1}
    assert summary["by_procedure"] == {"cleaning": 2, "(general)": 1, "clinic": 1}


def test_the_real_answer_key_is_valid_against_the_real_brochure():
    from evaluation.dataset import load_answer_key, load_source_text

    assert validate(load_answer_key(), load_source_text()) == []
