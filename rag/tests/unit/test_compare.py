import pytest

from evaluation.compare import compare


@pytest.fixture
def base(make_run, make_result):
    return make_run("20261010-100000-base", [
        make_result("whitening-price-01", passed=False),
        make_result("cleaning-price-01"),
        make_result("out-insurance-01"),
    ])


def test_metric_deltas(base, make_run, make_result):
    candidate = make_run("20261010-110000", [
        make_result("whitening-price-01"), make_result("cleaning-price-01"), make_result("out-insurance-01"),
    ])

    comparison = compare(base, candidate)

    delta = comparison["metric_deltas"]["overall.pass_rate"]
    assert delta["base"] == pytest.approx(2 / 3)
    assert delta["candidate"] == 1.0
    assert delta["delta"] == pytest.approx(1 / 3)
    assert comparison["comparable"] is True
    assert comparison["warnings"] == []


def test_regressions_and_improvements(base, make_run, make_result):
    candidate = make_run("20261010-110000", [
        make_result("whitening-price-01"),
        make_result("cleaning-price-01", passed=False, cause="retrieval_failure"),
        make_result("out-insurance-01"),
    ])

    comparison = compare(base, candidate)

    assert comparison["regressions"] == [{"item_id": "cleaning-price-01", "cause": "retrieval_failure"}]
    assert comparison["improvements"] == [{"item_id": "whitening-price-01", "previous_cause": "answer_failure"}]


def test_regressions_are_reported_even_when_the_overall_score_goes_up(make_run, make_result):
    before = make_run("20261010-100000", [
        make_result("whitening-price-01", passed=False),
        make_result("cleaning-price-01"),
        make_result("diff-appointment-01", passed=False),
        make_result("out-insurance-01", passed=False),
    ])
    after = make_run("20261010-110000", [
        make_result("whitening-price-01"),
        make_result("cleaning-price-01", passed=False),
        make_result("diff-appointment-01"),
        make_result("out-insurance-01"),
    ])

    comparison = compare(before, after)

    assert comparison["metric_deltas"]["overall.pass_rate"]["delta"] > 0
    assert [entry["item_id"] for entry in comparison["regressions"]] == ["cleaning-price-01"]


def test_different_subsets_are_not_comparable(base, make_run, make_result):
    holdout = make_run("20261010-110000", [make_result("cleaning-duration-01")], subset="holdout")

    comparison = compare(base, holdout)

    assert comparison["comparable"] is False
    assert "dev" in comparison["reason"] and "holdout" in comparison["reason"]
    assert comparison["metric_deltas"] == {}


def test_different_answer_key_warns_and_compares_common_items(base, make_run, make_result):
    candidate = make_run("20261010-110000", [
        make_result("whitening-price-01"),
        make_result("cleaning-price-01", passed=False),
        make_result("diff-appointment-01", passed=False),
    ], answer_key_hash="other-hash")

    comparison = compare(base, candidate)

    assert comparison["comparable"] is True
    assert len(comparison["warnings"]) == 1
    assert "2 items in common" in comparison["warnings"][0]
    assert "leaves 2 out" in comparison["warnings"][0]
    assert [entry["item_id"] for entry in comparison["regressions"]] == ["cleaning-price-01"]
    assert [entry["item_id"] for entry in comparison["improvements"]] == ["whitening-price-01"]


def test_config_changes_list_only_what_changed(base, make_run, make_result):
    candidate = make_run("20261010-110000", [make_result("cleaning-price-01")], vector_k=5, git_commit="def5678")

    assert compare(base, candidate)["config_changes"] == {"vector_k": {"base": 3, "candidate": 5}}


def test_within_noise_uses_measured_variance(make_run, make_result):
    results_before = [make_result("whitening-price-01", passed=False), make_result("cleaning-price-01")]
    results_after = [make_result("whitening-price-01"), make_result("cleaning-price-01")]
    noisy = {"overall.pass_rate": {"mean": 0.75, "min": 0.5, "max": 1.0}}
    steady = {"overall.pass_rate": {"mean": 0.5, "min": 0.5, "max": 0.5}}

    with_noise = compare(make_run("20261010-100000", results_before, variance=noisy),
                         make_run("20261010-110000", results_after))
    without_noise = compare(make_run("20261010-100000", results_before, variance=steady),
                            make_run("20261010-110000", results_after))
    unknown = compare(make_run("20261010-100000", results_before), make_run("20261010-110000", results_after))

    assert with_noise["within_noise"]["overall.pass_rate"] is True
    assert without_noise["within_noise"]["overall.pass_rate"] is False
    assert unknown["within_noise"]["overall.pass_rate"] is None
