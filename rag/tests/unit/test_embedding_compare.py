import pytest

from evaluation.embedding_compare import (
    cosine_scores,
    embed_all,
    evaluate,
    load_questions,
    mean_reciprocal_rank,
    rank_order,
    run,
    section_matches,
    summarize,
)

CLEANING = "Limpeza Dental — O Primeiro Passo"
ROOT = "Tratamento de Canal — Alivie a Dor"
CHUNK_SECTIONS = [CLEANING, ROOT]


class FakeEmbeddings:
    """A table of vectors: each text has the vector written for it, so the ranking is known in advance."""

    def __init__(self, table):
        self.table = table
        self.queries = []

    def embed_documents(self, texts):
        return [self.table[text] for text in texts]

    def embed_query(self, text):
        self.queries.append(text)
        return self.table[text]


def item(question, *expected):
    return {"question": question, "expected": list(expected)}


def test_a_question_whose_right_section_is_first_is_a_top_1_hit():
    order = rank_order([0.9, 0.1])

    rows, excluded = evaluate([item("preço da limpeza", CLEANING)], CHUNK_SECTIONS, [order])

    assert excluded == []
    assert rows == [{"question": "preço da limpeza", "expected": [CLEANING], "got": CLEANING, "rank": 1,
                     "top1": True, "top3": True}]


def test_a_right_section_in_third_place_is_a_top_3_hit_and_not_top_1():
    sections = [CLEANING, "Clareamento Dental", "Implantes Dentários", ROOT]
    order = [1, 2, 3, 0]

    rows, _ = evaluate([item("canal", CLEANING)], sections, [order])

    assert rows[0]["rank"] == 4
    assert rows[0]["top1"] is False and rows[0]["top3"] is False
    sections_3 = [ROOT, CLEANING, "Clareamento Dental"]
    rows, _ = evaluate([item("limpeza", CLEANING)], sections_3, [[0, 1, 2]])
    assert rows[0]["rank"] == 2 and rows[0]["top3"] is True and rows[0]["top1"] is False


def test_mrr_and_percentages_are_computed_over_the_scored_questions():
    rows = [
        {"rank": 1, "top1": True, "top3": True},
        {"rank": 2, "top1": False, "top3": True},
        {"rank": 4, "top1": False, "top3": False},
    ]

    summary = summarize(rows)

    assert mean_reciprocal_rank(rows) == pytest.approx((1 + 0.5 + 0.25) / 3)
    assert summary["mrr"] == pytest.approx(1.75 / 3)
    assert summary["scored"] == 3
    assert summary["top1"] == {"count": 1, "percent": pytest.approx(100 / 3)}
    assert summary["top3"] == {"count": 2, "percent": pytest.approx(200 / 3)}


def test_empty_rows_give_zero_not_a_division_error():
    assert summarize([])["mrr"] == 0.0
    assert summarize([])["top1"]["percent"] == 0.0


def test_a_question_whose_section_is_not_in_the_chunks_is_excluded_and_reported():
    items = [item("qual o siso", "Extração Dentária — Alívio"), item("canal", ROOT)]
    orders = [[0, 1], [1, 0]]

    rows, excluded = evaluate(items, CHUNK_SECTIONS, orders)

    assert excluded == [{"question": "qual o siso", "expected": ["Extração Dentária — Alívio"]}]
    assert len(rows) == 1 and rows[0]["question"] == "canal"
    assert summarize(rows)["scored"] == 1


def test_a_list_of_sections_counts_any_of_them_as_right():
    rows, _ = evaluate([item("dor de dente", "Extração Dentária", ROOT)], CHUNK_SECTIONS, [[1, 0]])

    assert rows[0]["top1"] is True and rows[0]["got"] == ROOT


def test_a_title_matches_by_its_name_before_the_separator():
    assert section_matches(CLEANING, "Limpeza Dental")
    assert section_matches(CLEANING, CLEANING)
    assert not section_matches(CLEANING, "Limpeza")
    assert not section_matches(CLEANING, "Clareamento Dental")


def test_questions_file_shape_maps_keys_to_titles_and_accepts_lists():
    data = {
        "sections": {"cleaning": "Limpeza Dental", "root": "Tratamento de Canal"},
        "questions": [
            {"q": "quanto é a limpeza", "section": "cleaning"},
            {"q": "dor forte", "section": ["root", "cleaning"]},
        ],
    }

    items = load_questions(data)

    assert items == [
        {"question": "quanto é a limpeza", "expected": ["Limpeza Dental"]},
        {"question": "dor forte", "expected": ["Tratamento de Canal", "Limpeza Dental"]},
    ]


def test_a_section_key_missing_from_sections_is_taken_as_the_title():
    items = load_questions({"sections": {}, "questions": [{"q": "x", "section": "Limpeza Dental"}]})

    assert items[0]["expected"] == ["Limpeza Dental"]


@pytest.mark.parametrize("data", [
    [],
    {"sections": {}},
    {"sections": {}, "questions": [{"q": "x"}]},
    {"sections": {}, "questions": [{"section": "a"}]},
    {"sections": {}, "questions": [{"q": "x", "section": []}]},
    {"sections": {}, "questions": [{"q": "x", "section": 3}]},
])
def test_a_malformed_questions_file_is_refused(data):
    with pytest.raises(ValueError):
        load_questions(data)


def test_cosine_scores_match_the_angle_between_vectors():
    scores = cosine_scores([1.0, 0.0], [[2.0, 0.0], [0.0, 5.0], [0.0, 0.0]])

    assert scores[0] == pytest.approx(1.0)
    assert scores[1] == pytest.approx(0.0)
    assert scores[2] == 0.0


def test_the_whole_run_with_fake_embeddings_reports_the_misses():
    table = {
        "limpeza dos dentes": [1.0, 0.0],
        "dor de canal": [0.2, 1.0],
        "Limpeza Dental — O Primeiro Passo": [1.0, 0.1],
        "Tratamento de Canal — Alivie a Dor": [0.0, 1.0],
    }
    provider = FakeEmbeddings(table)
    items = [item("limpeza dos dentes", CLEANING), item("dor de canal", CLEANING)]

    result = run(provider, items, [CLEANING, ROOT], CHUNK_SECTIONS)

    assert provider.queries == ["limpeza dos dentes", "dor de canal"]
    assert result["chunks"] == 2 and result["dimension"] == 2
    assert result["scored"] == 2
    assert result["top1"]["count"] == 1
    assert result["mrr"] == pytest.approx((1 + 0.5) / 2)
    assert [miss["question"] for miss in result["misses"]] == ["dor de canal"]
    assert result["misses"][0]["got"] == ROOT and result["misses"][0]["rank"] == 2


def test_embed_all_times_each_question_and_embeds_the_chunks_once():
    provider = FakeEmbeddings({"a": [1.0], "b": [0.0], "q1": [1.0], "q2": [0.0]})

    chunk_vectors, query_vectors, milliseconds = embed_all(provider, ["a", "b"], ["q1", "q2"])

    assert chunk_vectors == [[1.0], [0.0]]
    assert query_vectors == [[1.0], [0.0]]
    assert len(milliseconds) == 2 and all(ms >= 0 for ms in milliseconds)
