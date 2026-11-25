from types import SimpleNamespace

import pytest

from evaluation.cloud_run import INVALID_MESSAGE, CloudRun


def settings(provider):
    return SimpleNamespace(provider=provider, chat_model="chat-model-x", embedding_model="embed-model-y")


class FakeModel:
    def __init__(self, calls=0, rate_limited=0, failed=0):
        self.counters = {"calls": calls, "rate_limited": rate_limited, "failed": failed}

    def stats(self):
        return dict(self.counters)


def no_providers():
    raise AssertionError("the providers must not be read for this check")


def test_banner_names_the_provider_and_both_models():
    banner = CloudRun(settings("nvidia"), no_providers).banner()

    assert "provider nvidia" in banner
    assert "chat model chat-model-x" in banner
    assert "embedding model embed-model-y" in banner
    assert "Judge metrics are off" in banner


def test_ollama_run_keeps_the_preflight_and_the_judge_and_is_not_cloud():
    cloud_run = CloudRun(settings("ollama"), no_providers)

    assert cloud_run.is_cloud is False
    assert cloud_run.needs_ollama_preflight() is True
    assert cloud_run.judge_allowed() is True


def test_cloud_run_skips_the_ollama_preflight_and_turns_the_judge_off():
    cloud_run = CloudRun(settings("openai-compatible"), no_providers)

    assert cloud_run.is_cloud is True
    assert cloud_run.needs_ollama_preflight() is False
    assert cloud_run.judge_allowed() is False


def test_stats_sum_both_providers():
    generator, embeddings = FakeModel(calls=3, rate_limited=1), FakeModel(calls=2, failed=1)
    cloud_run = CloudRun(settings("nvidia"), lambda: (generator, embeddings))

    assert cloud_run.stats() == {"calls": 5, "rate_limited": 1, "failed": 1}


def test_summary_line_has_the_format_of_the_run_output():
    cloud_run = CloudRun(settings("nvidia"), no_providers)

    line = cloud_run.summary_line({"calls": 7, "rate_limited": 2, "failed": 0})

    assert line == "model calls: 7, rate limited: 2, failed: 0"


@pytest.mark.parametrize(("rate_limited", "failed", "invalid"), [
    (0, 0, False),
    (1, 0, True),
    (0, 1, True),
])
def test_a_run_is_invalid_when_the_cloud_model_was_rate_limited_or_failed(rate_limited, failed, invalid):
    stats = {"calls": 4, "rate_limited": rate_limited, "failed": failed}

    assert CloudRun(settings("nvidia"), no_providers).is_invalid(stats) is invalid


def test_invalid_message_says_not_to_use_the_run_as_a_reference():
    assert "do not use it as a reference" in INVALID_MESSAGE
