import csv
import time
from datetime import datetime
from types import SimpleNamespace

import pytest

from evaluation import experiments as bench
from assistant.settings import Experiment

SECTION = Experiment("section_hybrid", "section", "hybrid", 4)
PAGE = Experiment("page_hybrid", "page", "hybrid", 4, 0.5, True)
RECURSIVE = Experiment("recursive_hybrid", "recursive_500_200", "hybrid", 4)

# Chunks of the fake brochure, for the questions of the answer key in conftest.py
WHITENING = "Teeth Whitening\nPrice: $180–$450"
CLEANING = "Dental Cleaning\nDuration: 30–50 minutes\nPrice: $40–$85"
PRICE_ONLY = "How it works: whitening gel\nPrice: $180–$450"
DIFFERENTIALS = "Why Choose DentalSafe?\n- Fast appointments (within 72 hours)"


def chunk(content, similarity):
    return SimpleNamespace(content=content, rank=1, score=None, similarity=similarity)


def retrieval(*chunks):
    chunks = [SimpleNamespace(content=c.content, rank=rank, score=None, similarity=c.similarity)
              for rank, c in enumerate(chunks, 1)]
    return SimpleNamespace(vector=chunks, bm25=chunks, fused=chunks)


def to_dataclass(namespace):
    """The module's asdict() needs a dataclass; converts the fake chunks."""
    from assistant.pipeline import RetrievalResult, RetrievedChunk

    convert = lambda items: [RetrievedChunk(c.content, c.rank, c.score, c.similarity) for c in items]  # noqa: E731
    return RetrievalResult(convert(namespace.vector), convert(namespace.bm25), convert(namespace.fused))


ANSWERS = {
    "How much is teeth whitening?": [chunk(WHITENING, 0.8), chunk(CLEANING, 0.6)],
    "How much is a dental cleaning?": [chunk(CLEANING, 0.7)],
    "How soon can I get an appointment?": [chunk(DIFFERENTIALS, 0.5)],
}


def retrieve_all(question, experiment):
    return to_dataclass(retrieval(*ANSWERS.get(question, [])))


def no_index_problem(experiment):
    return None


def run(experiment=SECTION, answer_key=None, retrieve_fn=retrieve_all, **options):
    options.setdefault("index_check", no_index_problem)
    return bench.run_experiment(experiment, bench.select_items(answer_key), answer_key, retrieve_fn=retrieve_fn, **options)


def test_only_answerable_dev_questions_are_evaluated(answer_key):
    ids = [item.id for item in bench.select_items(answer_key)]

    assert ids == ["whitening-price-01", "cleaning-price-01", "diff-appointment-01"]
    assert "cleaning-duration-01" not in ids  # reserved part
    assert "out-insurance-01" not in ids  # no answer in the brochure


def test_experiment_metrics(answer_key):
    result = run(answer_key=answer_key)

    assert result.status == bench.OK
    assert (result.hits, result.total) == (3, 3)
    assert result.true_rate == 1.0
    assert result.score == pytest.approx((0.7 + 0.7 + 0.5) / 3)  # the 1st question has the mean of 0.8 and 0.6
    assert result.anchored_rate == 1.0
    assert result.avg_latency_ms >= 0
    assert [q.retrieved_count for q in result.questions] == [2, 1, 1]


def test_question_score_is_the_mean_similarity_of_the_returned_chunks(answer_key):
    question = run(answer_key=answer_key).questions[0]

    assert question.item_id == "whitening-price-01"
    assert question.hit is True
    assert question.score == pytest.approx(0.7)


def test_question_without_chunks_is_a_miss_with_zero_score(answer_key):
    result = run(answer_key=answer_key, retrieve_fn=lambda question, experiment: to_dataclass(retrieval()))

    assert result.status == bench.OK
    assert (result.hits, result.total, result.score) == (0, 3, 0.0)
    assert all(q.retrieved_count == 0 and q.score == 0.0 and not q.hit for q in result.questions)


def test_hit_needs_every_evidence_of_the_item(answer_key):
    from dataclasses import replace

    both = replace(answer_key.by_id()["whitening-price-01"], id="comp-01", procedure=None,
                   evidence=("Price: $180–$450", "Price: $40–$85"))

    def one_of_two(question, experiment):
        return to_dataclass(retrieval(chunk(WHITENING, 0.8)))

    def two_of_two(question, experiment):
        return to_dataclass(retrieval(chunk(WHITENING, 0.8), chunk(CLEANING, 0.6)))

    partial = bench.run_experiment(SECTION, [both], answer_key, retrieve_fn=one_of_two, index_check=no_index_problem)
    complete = bench.run_experiment(SECTION, [both], answer_key, retrieve_fn=two_of_two, index_check=no_index_problem)

    assert partial.questions[0].hit is False
    assert complete.questions[0].hit is True


def test_anchored_rate_counts_only_questions_about_a_procedure(answer_key):
    def unanchored(question, experiment):
        if "whitening" in question:
            return to_dataclass(retrieval(chunk(PRICE_ONLY, 0.8)))
        return retrieve_all(question, experiment)

    result = run(answer_key=answer_key, retrieve_fn=unanchored)

    assert result.hits == 3
    assert result.questions[0].anchored is False
    assert result.anchored_rate == 0.5  # whitening no, cleaning yes; the general question is left out


def test_warm_up_call_is_not_measured(answer_key):
    calls = []

    def slow_first(question, experiment):
        calls.append(question)
        if len(calls) == 1:
            time.sleep(0.2)
        return retrieve_all(question, experiment)

    result = run(answer_key=answer_key, retrieve_fn=slow_first)

    assert calls[0] == "Hello" and len(calls) == 4
    assert result.avg_latency_ms < 100


def test_latency_includes_everything_the_search_does(answer_key):
    def slow(question, experiment):
        time.sleep(0.05)  # like HyDE's generation inside the search
        return retrieve_all(question, experiment)

    assert run(answer_key=answer_key, retrieve_fn=slow).avg_latency_ms >= 50


def test_missing_or_stale_index_is_not_run_and_does_not_search(answer_key):
    calls = []
    reason = "the index of strategy \"page\" has not been built yet; run: python -m assistant.ingest page"

    result = run(PAGE, answer_key, retrieve_fn=lambda q, e: calls.append(q), index_check=lambda experiment: reason)

    assert (result.status, result.reason) == (bench.NOT_RUN, reason)
    assert result.questions == [] and calls == []


def test_one_experiment_that_cannot_run_does_not_stop_the_others(answer_key):
    results = bench.run_all(
        [PAGE, SECTION], bench.select_items(answer_key), answer_key, retrieve_fn=retrieve_all,
        index_check=lambda experiment: "missing index" if experiment is PAGE else None,
    )

    assert [result.status for result in results] == [bench.NOT_RUN, bench.OK]


def test_failure_at_warm_up_is_not_run(answer_key):
    def offline(question, experiment):
        raise ConnectionError("Ollama is down")

    result = run(answer_key=answer_key, retrieve_fn=offline)

    assert result.status == bench.NOT_RUN
    assert "Ollama is down" in result.reason


def test_failure_in_the_middle_is_incomplete_and_keeps_what_finished(answer_key):
    def fails_on_the_second(question, experiment):
        if "cleaning" in question:
            raise ConnectionError("Ollama went down")
        return retrieve_all(question, experiment)

    result = run(answer_key=answer_key, retrieve_fn=fails_on_the_second)

    assert result.status == bench.INCOMPLETE
    assert [q.item_id for q in result.questions] == ["whitening-price-01"]
    assert "1 of 3" in result.reason and "Ollama went down" in result.reason


def test_progress_and_question_callbacks(answer_key):
    progress, seen = [], []

    run(answer_key=answer_key, on_progress=lambda: progress.append(1), on_question=seen.append)

    assert len(progress) == 3
    assert [q.item_id for q in seen] == ["whitening-price-01", "cleaning-price-01", "diff-appointment-01"]


def result_with(experiment, hits, total, score, status=bench.OK, reason=""):
    questions = [
        bench.QuestionResult(experiment.exp_name, f"item-{n}", f"Question {n}, please?", n < hits, score, True, 2, 40.0)
        for n in range(total)
    ]
    return bench.ExperimentResult(experiment, status, reason, questions)


def test_sorted_by_true_rate_then_score_then_name():
    a = result_with(Experiment("b_exp", "section", "hybrid", 4), 3, 4, 0.60)
    b = result_with(Experiment("a_exp", "section", "hybrid", 4), 3, 4, 0.60)
    best = result_with(Experiment("z_exp", "section", "hybrid", 4), 4, 4, 0.10)
    higher_score = result_with(Experiment("c_exp", "section", "hybrid", 4), 3, 4, 0.90)

    ordered = bench.sort_results([a, b, best, higher_score])

    assert [r.experiment.exp_name for r in ordered] == ["z_exp", "c_exp", "a_exp", "b_exp"]


def test_hyde_does_not_win_a_tie_with_its_inflated_score():
    plain = result_with(Experiment("section_hybrid", "section", "hybrid", 4), 3, 4, 0.67)
    hyde = result_with(Experiment("section_hyde", "section", "hybrid", 4, 0.0, True), 3, 4, 0.78)
    better_hyde = result_with(Experiment("better_hyde", "section", "hybrid", 4, 0.0, True), 4, 4, 0.78)

    ordered = bench.sort_results([hyde, plain, better_hyde])

    assert [r.experiment.exp_name for r in ordered] == ["better_hyde", "section_hybrid", "section_hyde"]


def test_experiments_that_did_not_finish_go_last():
    not_run = bench.ExperimentResult(PAGE, bench.NOT_RUN, "missing index")
    incomplete = result_with(RECURSIVE, 1, 1, 0.9, bench.INCOMPLETE, "interrupted")
    ok = result_with(SECTION, 0, 2, 0.1)

    ordered = bench.sort_results([not_run, incomplete, ok])

    assert [r.status for r in ordered] == [bench.OK, bench.NOT_RUN, bench.INCOMPLETE]


def test_question_line_format():
    hit = bench.QuestionResult("e", "i", "How much is teeth whitening?", True, 0.7149, True, 2, 40.0)
    miss = bench.QuestionResult("e", "i", "Do the treatments hurt?", False, 0.6, False, 2, 40.0)

    assert bench.format_question_line(hit) == "How much is teeth whitening?;true;0.71"
    assert bench.format_question_line(miss) == "Do the treatments hurt?;false;0.60"


def read(path):
    raw = path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")  # BOM, so Excel opens it with the right encoding
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))  # comma-separated, the default


def test_csv_files(tmp_path):
    results = [
        result_with(SECTION, 3, 4, 0.66125),
        bench.ExperimentResult(PAGE, bench.NOT_RUN, "missing index; run: python -m assistant.ingest page"),
    ]
    started_at = datetime(2026, 10, 10, 23, 5, 9)

    summary_path, questions_path = bench.write_csv(results, started_at, "2026-10-11.1", "nomic-embed-text", tmp_path)

    assert summary_path.name == "20261010-230509-summary.csv"
    assert questions_path.name == "20261010-230509-questions.csv"

    summary = read(summary_path)
    assert tuple(summary[0]) == bench.SUMMARY_COLUMNS
    assert summary[0] == {
        "experiment": "section_hybrid", "search_type": "hybrid", "collection": "section", "match_threshold": "0.00",
        "match_count": "4", "use_hyde": "false", "score": "0.6613", "hits": "3", "total": "4", "true_rate": "0.7500",
        "anchored_rate": "1.0000", "avg_latency_ms": "40.0", "status": "ok", "reason": "",
        "answer_key_version": "2026-10-11.1", "embedding_model": "nomic-embed-text",
    }
    assert summary[1]["experiment"] == "page_hybrid"
    assert (summary[1]["match_threshold"], summary[1]["use_hyde"]) == ("0.50", "true")
    assert (summary[1]["status"], summary[1]["score"], summary[1]["hits"]) == ("not_run", "", "")
    assert "python -m assistant.ingest page" in summary[1]["reason"]

    questions = read(questions_path)
    assert tuple(questions[0]) == bench.QUESTION_COLUMNS
    assert len(questions) == 4  # only the experiment that ran has rows
    assert questions[0] == {
        "experiment": "section_hybrid", "item_id": "item-0", "question": "Question 0, please?", "hit": "true",
        "score": "0.6613", "anchored": "true", "retrieved_count": "2", "latency_ms": "40.0",
    }  # the comma inside the question does not break the columns
    assert questions[3]["hit"] == "false"


def test_two_runs_do_not_overwrite_each_other(tmp_path):
    started_at = datetime(2026, 10, 10, 23, 5, 9)
    results = [result_with(SECTION, 1, 1, 0.5)]

    first, _ = bench.write_csv(results, started_at, "v", "m", tmp_path)
    second, second_questions = bench.write_csv(results, started_at, "v", "m", tmp_path)

    assert first != second and first.exists() and second.exists()
    assert second.name == "20261010-230509-2-summary.csv"
    assert second_questions.name == "20261010-230509-2-questions.csv"


def test_comparison_table_has_the_reference_columns_and_keeps_full_names():
    from evaluation.report import experiments_table

    lines = experiments_table([
        result_with(Experiment("recursive_500_200_hybrid", "recursive_500_200", "hybrid", 4), 31, 38, 0.67),
        bench.ExperimentResult(PAGE, bench.NOT_RUN, "missing index"),
    ])

    header = [cell.strip() for cell in lines[1].strip("|").split("|")]
    assert header == ["Experiment", "Strategy", "Collection", "Threshold", "Count", "HyDE", "Score", "True Rate",
                      "Anchored", "Time"]
    first = [cell.strip() for cell in lines[3].strip("|").split("|")]
    assert first == ["recursive_500_200_hybrid", "hybrid", "recursive_500_200", "0.00", "4", "False", "0.67",
                     "31/38", "100.0%", "40 ms"]
    second = [cell.strip() for cell in lines[4].strip("|").split("|")]
    assert second == ["page_hybrid", "hybrid", "page", "0.50", "4", "True", "-", "-", "-", "-"]
    assert len({len(line) for line in lines}) == 1
