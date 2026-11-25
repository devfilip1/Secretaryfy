import httpx

from assistant.model_stats import HasModelStats, collect_model_stats
from assistant.openai_compat import OpenAICompatChat

ZEROS = {"calls": 0, "rate_limited": 0, "failed": 0}


class Counted:
    def __init__(self, calls, rate_limited, failed):
        self._stats = {"calls": calls, "rate_limited": rate_limited, "failed": failed}

    def stats(self):
        return dict(self._stats)


class Plain:
    """Like the Ollama clients: no stats method."""


def test_the_stats_of_the_providers_are_summed():
    assert collect_model_stats(Counted(2, 1, 0), Counted(3, 0, 1)) == {"calls": 5, "rate_limited": 1, "failed": 1}


def test_a_provider_without_stats_is_skipped():
    assert collect_model_stats(Counted(2, 1, 0), Plain()) == {"calls": 2, "rate_limited": 1, "failed": 0}


def test_zeros_when_no_provider_has_stats():
    assert collect_model_stats() == ZEROS
    assert collect_model_stats(Plain()) == ZEROS


def test_a_cloud_client_is_a_counted_model_and_its_calls_are_collected():
    reply = httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})
    client = OpenAICompatChat("https://cloud.example/v1", "key", timeout_s=5,
                              transport=httpx.MockTransport(lambda request: reply))

    client.generate("hi", model="m", temperature=None, seed=None, max_tokens=None)

    assert HasModelStats in OpenAICompatChat.__mro__
    assert collect_model_stats(client, Plain()) == {"calls": 1, "rate_limited": 0, "failed": 0}
