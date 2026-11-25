"""Counters of the cloud models (calls, rate-limited responses, failures). Ollama clients have none and are skipped."""
from typing import Protocol, TypedDict


class ModelStats(TypedDict):
    calls: int
    rate_limited: int
    failed: int


class HasModelStats(Protocol):
    """A model client that counts its calls: stats() returns ModelStats."""

    def stats(self) -> ModelStats: ...


def collect_model_stats(*providers) -> dict[str, int]:
    """The sum of the stats of the providers that have a stats method; zeros when none does."""
    totals = {"calls": 0, "rate_limited": 0, "failed": 0}
    for provider in providers:
        stats = getattr(provider, "stats", None)
        if not callable(stats):
            continue
        counters = stats()
        for name in totals:
            totals[name] += counters[name]
    return totals
