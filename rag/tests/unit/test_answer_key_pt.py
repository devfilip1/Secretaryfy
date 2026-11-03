from pathlib import Path

from evaluation.dataset import load_answer_key, validate

RAG = Path(__file__).resolve().parents[2]


def test_the_portuguese_answer_key_is_valid_for_the_portuguese_brochure():
    """If it fails, sorrisopleno.md and answer_key_pt.json no longer agree (evidence, values or coverage)."""
    answer_key = load_answer_key(RAG / "evaluation" / "data" / "answer_key_pt.json")
    brochure = (RAG / "data" / "source" / "sorrisopleno.md").read_text(encoding="utf-8")

    assert answer_key.language == "pt"
    assert validate(answer_key, brochure) == []


def test_it_asks_the_same_questions_as_the_english_key():
    english = load_answer_key(RAG / "evaluation" / "data" / "answer_key.json")
    portuguese = load_answer_key(RAG / "evaluation" / "data" / "answer_key_pt.json")

    renamed = {"adv-portuguese-01": "adv-english-01"}
    assert [renamed.get(item.id, item.id) for item in english.items] == [item.id for item in portuguese.items]
    assert [(item.split, item.answerable) for item in english.items] == [(item.split, item.answerable) for item in portuguese.items]
