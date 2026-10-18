import json
from datetime import datetime

import jsonschema
import pytest

from evaluation import history


def test_complete_run_is_saved_in_its_own_folder(tmp_path, make_run, make_result):
    run = make_run("20261010-100000-test", [make_result("cleaning-price-01")])

    folder = history.save_run(run, tmp_path)

    assert folder == tmp_path / "20261010-100000-test"
    assert json.loads((folder / "run.json").read_text(encoding="utf-8")) == run


def test_incomplete_run_goes_to_incomplete_folder_and_stays_out_of_history(tmp_path, make_run, make_result):
    history.save_run(make_run("20261010-100000", [make_result("cleaning-price-01")]), tmp_path)
    partial = make_run("20261010-110000", [make_result("cleaning-price-01")], status="incomplete")
    partial["skipped"] = ["whitening-price-01"]

    folder = history.save_run(partial, tmp_path)

    assert folder == tmp_path / "_incomplete" / "20261010-110000"
    assert [run["run_id"] for run in history.list_runs(tmp_path)] == ["20261010-100000"]
    with pytest.raises(FileNotFoundError):
        history.load_run("20261010-110000", tmp_path)


def test_run_outside_the_schema_is_not_saved(tmp_path, make_run, make_result):
    run = make_run("20261010-100000", [make_result("cleaning-price-01")])
    del run["config"]["kb_hash"]

    with pytest.raises(jsonschema.ValidationError):
        history.save_run(run, tmp_path)

    assert list(tmp_path.iterdir()) == []


def test_list_runs_newest_first(tmp_path, make_run, make_result):
    for run_id in ("20261010-100000", "20261011-090000-b", "20261010-120000-a"):
        history.save_run(make_run(run_id, [make_result("cleaning-price-01")]), tmp_path)

    assert [run["run_id"] for run in history.list_runs(tmp_path)] == [
        "20261011-090000-b", "20261010-120000-a", "20261010-100000",
    ]


def test_list_runs_without_folder(tmp_path):
    assert history.list_runs(tmp_path / "does-not-exist") == []


def test_latest_run_by_subset(tmp_path, make_run, make_result):
    history.save_run(make_run("20261010-100000", [make_result("cleaning-price-01")]), tmp_path)
    history.save_run(make_run("20261010-110000", [make_result("cleaning-duration-01")], subset="holdout"), tmp_path)

    assert history.latest_run("dev", tmp_path)["run_id"] == "20261010-100000"
    assert history.latest_run("holdout", tmp_path)["run_id"] == "20261010-110000"
    assert history.latest_run("smoke", tmp_path) is None


def test_baseline_is_kept_per_subset(tmp_path, make_run, make_result):
    history.save_run(make_run("20261010-100000", [make_result("cleaning-price-01")]), tmp_path)
    history.save_run(make_run("20261010-110000", [make_result("cleaning-duration-01")], subset="holdout"), tmp_path)

    history.set_baseline("20261010-100000", tmp_path)
    history.set_baseline("20261010-110000", tmp_path)

    assert history.get_baseline("dev", tmp_path) == "20261010-100000"
    assert history.get_baseline("holdout", tmp_path) == "20261010-110000"
    assert "set_at" in json.loads((tmp_path / "baseline.json").read_text(encoding="utf-8"))


def test_no_baseline(tmp_path):
    assert history.get_baseline("dev", tmp_path) is None


def test_baseline_rejects_missing_run(tmp_path):
    with pytest.raises(FileNotFoundError):
        history.set_baseline("20261010-999999", tmp_path)


def test_baseline_rejects_incomplete_run(tmp_path, make_run, make_result):
    history.save_run(make_run("20261010-110000", [make_result("cleaning-price-01")], status="incomplete"), tmp_path)

    with pytest.raises(FileNotFoundError):
        history.set_baseline("20261010-110000", tmp_path)


def test_baseline_rejects_smoke_run(tmp_path, make_run, make_result):
    history.save_run(make_run("20261010-100000", [make_result("whitening-price-01")], subset="smoke"), tmp_path)

    with pytest.raises(ValueError):
        history.set_baseline("20261010-100000", tmp_path)


def test_new_run_id():
    now = datetime(2026, 10, 10, 17, 5, 9)

    assert history.new_run_id(None, now) == "20261010-170509"
    assert history.new_run_id("Chunk per Procedure!", now) == "20261010-170509-chunk-per-procedure"
    assert history.new_run_id("---", now) == "20261010-170509"


def test_run_records_the_experiment_and_accepts_strategies_without_chunk_size(tmp_path, make_run, make_result):
    run = make_run(
        "20261010-100000", [make_result("cleaning-price-01")],
        experiment="page_hybrid", strategy="page", search_type="hybrid", match_count=4, match_threshold=0.0,
        use_hyde=False, chunk_size=None, chunk_overlap=None, final_k=4,
    )

    history.save_run(run, tmp_path)

    saved = history.load_run("20261010-100000", tmp_path)["config"]
    assert (saved["experiment"], saved["strategy"], saved["chunk_size"]) == ("page_hybrid", "page", None)


def test_run_saved_before_the_experiments_is_still_valid_and_comparable(tmp_path, make_run, make_result):
    from evaluation.compare import compare

    old = make_run("20261010-100000", [make_result("cleaning-price-01")])  # without the experiment fields
    new = make_run("20261010-110000", [make_result("cleaning-price-01")], experiment="section_hybrid",
                   strategy="section", search_type="hybrid", match_count=4, match_threshold=0.0, use_hyde=False)
    history.save_run(old, tmp_path)
    history.save_run(new, tmp_path)

    comparison = compare(history.load_run(old["run_id"], tmp_path), history.load_run(new["run_id"], tmp_path))

    assert "experiment" not in old["config"]
    assert comparison["comparable"] is True
    assert comparison["config_changes"] == {}
