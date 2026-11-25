import threading
from types import SimpleNamespace

import pytest

from assistant.rate_limiter import WINDOW_S, RateLimiter, reset_shared_limiters, shared_limiter


class FakeClock:
    """Time that only moves when the code sleeps: the bucket can be checked without waiting."""

    def __init__(self):
        self.t = 0.0
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds


@pytest.fixture(autouse=True)
def fresh_shared_limiters():
    reset_shared_limiters()
    yield
    reset_shared_limiters()


def test_the_first_calls_up_to_the_burst_do_not_wait():
    clock = FakeClock()
    limiter = RateLimiter(3, burst=3, sleep=clock.sleep, now=clock.now)

    for _ in range(3):
        limiter.wait_for_slot()

    assert clock.slept == []


def test_the_call_after_the_burst_waits_for_one_refilled_token():
    clock = FakeClock()
    limiter = RateLimiter(3, burst=3, sleep=clock.sleep, now=clock.now)
    for _ in range(3):
        limiter.wait_for_slot()

    limiter.wait_for_slot()

    assert clock.slept == [pytest.approx(WINDOW_S / 3)]  # 60 / 3 = 20 s per token


def test_a_burst_of_two_calls_with_a_limit_of_35_does_not_wait():
    clock = FakeClock()
    limiter = RateLimiter(35, sleep=clock.sleep, now=clock.now)

    limiter.wait_for_slot()  # the embeddings call of a question
    limiter.wait_for_slot()  # the chat call of the same question

    assert clock.slept == []


def test_the_default_burst_is_four_calls():
    clock = FakeClock()
    limiter = RateLimiter(35, sleep=clock.sleep, now=clock.now)

    for _ in range(4):
        limiter.wait_for_slot()
    assert clock.slept == []

    limiter.wait_for_slot()
    assert clock.slept == [pytest.approx(WINDOW_S / 35)]


def test_tokens_refill_over_time_and_never_pass_the_burst():
    clock = FakeClock()
    limiter = RateLimiter(60, burst=3, sleep=clock.sleep, now=clock.now)  # one token a second
    for _ in range(3):
        limiter.wait_for_slot()

    clock.t = 2.0  # two tokens are back
    limiter.wait_for_slot()
    limiter.wait_for_slot()
    assert clock.slept == []
    limiter.wait_for_slot()
    assert clock.slept == [pytest.approx(1.0)]

    clock.t = 1000.0  # a long pause fills the bucket up to the burst, not beyond it
    for _ in range(3):
        limiter.wait_for_slot()
    assert clock.slept == [pytest.approx(1.0)]
    limiter.wait_for_slot()
    assert clock.slept == [pytest.approx(1.0), pytest.approx(1.0)]


def test_no_limit_never_waits():
    clock = FakeClock()
    limiter = RateLimiter(None, sleep=clock.sleep, now=clock.now)

    for _ in range(50):
        limiter.wait_for_slot()

    assert clock.slept == []


def test_sustained_calls_never_exceed_the_limit_per_minute():
    clock = FakeClock()
    limit, burst = 35, 4
    limiter = RateLimiter(limit, burst=burst, sleep=clock.sleep, now=clock.now)
    starts = []
    for _ in range(100):
        limiter.wait_for_slot()
        starts.append(clock.now())  # the reserved start time: the fake clock is there when the call goes out

    assert starts[:burst] == [0.0] * burst
    for i in range(burst, len(starts) - limit):
        assert starts[i + limit] - starts[i] >= WINDOW_S - 1e-9  # after the burst, any 35 calls span a minute
    assert sum(start < WINDOW_S for start in starts) <= burst + limit


def test_concurrent_callers_on_an_empty_bucket_get_distinct_ordered_waits():
    slept = []
    limiter = RateLimiter(1, burst=1, sleep=slept.append, now=lambda: 0.0)  # one a minute; the clock stands still
    threads = [threading.Thread(target=limiter.wait_for_slot) for _ in range(5)]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(slept) == [pytest.approx(60.0), pytest.approx(120.0), pytest.approx(180.0), pytest.approx(240.0)]
    # the first one takes the only token at once


def test_clients_of_one_provider_and_limit_get_the_same_limiter():
    first = shared_limiter(SimpleNamespace(provider="nvidia", max_per_minute=35))
    second = shared_limiter(SimpleNamespace(provider="nvidia", max_per_minute=35))

    assert first is second


def test_another_provider_or_limit_gets_another_limiter():
    first = shared_limiter(SimpleNamespace(provider="nvidia", max_per_minute=35))

    assert shared_limiter(SimpleNamespace(provider="openai-compatible", max_per_minute=35)) is not first
    assert shared_limiter(SimpleNamespace(provider="nvidia", max_per_minute=10)) is not first


def test_reset_forgets_the_shared_limiters():
    settings = SimpleNamespace(provider="nvidia", max_per_minute=35)
    first = shared_limiter(settings)

    reset_shared_limiters()

    assert shared_limiter(settings) is not first
