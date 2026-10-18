from evaluation.kb_checks import find_corrupted, find_duplicates, find_source_mismatch, find_unanchored_facts

HEADING = "Teeth Whitening — Whiter Teeth in Just a Few Days"
PRICE = "Price: $180–$450"
CLEANING = "Dental Cleaning\nDuration: 30–50 minutes\nPrice: $40–$85"
DIFFERENTIAL = "Fast appointments (within 72 hours)"


def test_duplicates_report_the_number_of_repetitions():
    chunks = [CLEANING, HEADING, CLEANING, "Dental  Cleaning\nDuration: 30–50 minutes\n\nPrice: $40–$85"]

    assert find_duplicates(chunks) == [{"content": CLEANING, "count": 3}]


def test_no_duplicates():
    assert find_duplicates([CLEANING, HEADING]) == []


def test_fact_in_a_chunk_without_the_procedure_name_is_unanchored(answer_key):
    chunks = [HEADING, f"How it works: whitening gel\n{PRICE}", CLEANING, DIFFERENTIAL]

    assert find_unanchored_facts(answer_key, chunks) == [{
        "kind": "unanchored", "item_id": "whitening-price-01", "procedure": "whitening", "evidence": PRICE,
    }]


def test_fact_with_the_procedure_name_in_some_chunk_is_fine(answer_key):
    chunks = [f"How it works: gel\n{PRICE}", f"{HEADING}\n{PRICE}", CLEANING, DIFFERENTIAL]

    assert find_unanchored_facts(answer_key, chunks) == []


def test_evidence_cut_by_the_split_is_missing(answer_key):
    chunks = [f"{HEADING}\nPrice: $180–", "$450\nResult", CLEANING, DIFFERENTIAL]

    problems = find_unanchored_facts(answer_key, chunks)

    assert [(p["kind"], p["item_id"]) for p in problems] == [("missing", "whitening-price-01")]


def test_item_without_procedure_only_needs_the_evidence(answer_key):
    chunks = [f"{HEADING}\n{PRICE}", CLEANING]

    problems = find_unanchored_facts(answer_key, chunks)

    assert [(p["kind"], p["item_id"]) for p in problems] == [("missing", "diff-appointment-01")]


def test_corrupted_characters():
    chunks = ["A ■■■anium post in the bone", "text with �", "bell\x07", "\x7f  Fresher breath", CLEANING]

    assert find_corrupted(chunks) == [
        {"content": "A ■■■anium post in the bone", "chars": ["U+25A0"]},
        {"content": "text with �", "chars": ["U+FFFD"]},
        {"content": "bell\x07", "chars": ["U+0007"]},
        {"content": "\x7f  Fresher breath", "chars": ["U+007F"]},
    ]


def test_normal_punctuation_is_not_corrupted():
    assert find_corrupted(["Café – naïve — $1,500 | Monthly\n\tWisdom tooth (within 72 hours) + polishing"]) == []


def test_sources_with_the_same_content_match():
    report = find_source_mismatch([CLEANING, HEADING], [HEADING, CLEANING])

    assert report == {"vector_count": 2, "file_count": 2, "only_in_vector": 0, "only_in_file": 0, "mismatch": False}


def test_sources_with_different_count_and_content():
    report = find_source_mismatch([CLEANING] * 5 + [HEADING], [CLEANING, PRICE])

    assert report == {"vector_count": 6, "file_count": 2, "only_in_vector": 5, "only_in_file": 1, "mismatch": True}
