"""Client-side limit of the requests per minute to one cloud provider. Every client of that provider shares one RateLimiter,
so the chat and the embeddings calls of a question count against the same quota."""
import threading
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from assistant.config import ModelSettings

WINDOW_S = 60.0
DEFAULT_BURST = 4  # the provider throttles bursts: a few calls at once are fine, a flood of them gets 429


class RateLimiter:
    """Token bucket: holds up to `burst` tokens, refilled at max_per_minute per minute, starting full. Each request takes
    one token. wait_for_slot() reserves the token now or the moment the next one exists, and sleeps until then (outside
    the lock), so concurrent callers queue in call order. With max_per_minute None nothing waits."""

    def __init__(self, max_per_minute: int | None, *, burst: int = DEFAULT_BURST, sleep=time.sleep, now=time.monotonic):
        self._max_per_minute = max_per_minute
        self._rate = (max_per_minute or 0) / WINDOW_S  # tokens per second
        self._capacity = float(burst)
        self._tokens = float(burst)
        self._sleep = sleep
        self._now = now
        self._updated = now()
        self._lock = threading.Lock()

    def wait_for_slot(self):
        if not self._max_per_minute:
            return
        with self._lock:
            current = self._now()
            refilled = self._tokens + (current - self._updated) * self._rate
            self._tokens = min(self._capacity, refilled)
            self._updated = current
            self._tokens -= 1  # a negative balance is a reservation: the next caller waits for one more token
            wait = 0.0 if self._tokens >= 0 else -self._tokens / self._rate
        if wait > 0:
            self._sleep(wait)


_shared: dict[tuple[str, int | None], RateLimiter] = {}
_shared_lock = threading.Lock()


def shared_limiter(settings: "ModelSettings") -> RateLimiter:
    """The one limiter of the provider in settings: every client built with the same provider and limit gets it."""
    key = (settings.provider, settings.max_per_minute)
    with _shared_lock:
        if key not in _shared:
            _shared[key] = RateLimiter(settings.max_per_minute)
        return _shared[key]


def reset_shared_limiters():
    """Forgets the shared limiters, so the next shared_limiter call makes new ones. For the tests."""
    with _shared_lock:
        _shared.clear()
