import json

import httpx
import pytest
from langchain_core.prompts import ChatPromptTemplate

from assistant.generation.model import TextGenerator
from assistant.openai_compat import ModelUnavailable, OpenAICompatChat, OpenAICompatClient, OpenAICompatEmbeddings
from assistant.rate_limiter import RateLimiter
from assistant.storage.embeddings import EmbeddingProvider

BASE = "https://cloud.example/v1/"
KEY = "sk-test-key-123"
SCHEMA = {"type": "object", "properties": {"kind": {"type": "string"}}, "required": ["kind"], "additionalProperties": False}


class FakeClock:
    """Time that only moves when the code sleeps: the limiter and the retries can be checked without waiting."""

    def __init__(self):
        self.t = 0.0
        self.slept = []

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds


def chat_reply(text="ok"):
    return {"choices": [{"message": {"content": text}}]}


def embed_reply(vectors):
    return {"data": [{"index": i, "embedding": vector} for i, vector in enumerate(vectors)]}


def ok(kind):
    return httpx.Response(200, json=chat_reply() if kind == "chat" else embed_reply([[1.0]]))


def handler(replies, requests):
    queue = list(replies)

    def handle(request):
        requests.append(request)
        return queue.pop(0)

    return handle


def build(kind, replies, requests, clock, **options):
    transport = httpx.MockTransport(handler(replies, requests))
    common = dict(timeout_s=5, transport=transport, sleep=clock.sleep, jitter=lambda: 0.0, **options)
    if kind == "chat":
        return OpenAICompatChat(BASE, KEY, **common)
    return OpenAICompatEmbeddings(BASE, KEY, "embed-model", **common)


def call(kind, client):
    if kind == "chat":
        return client.generate("hi", model="m", temperature=None, seed=None, max_tokens=None)
    return client.embed_query("hi")


def bodies(requests):
    return [json.loads(request.content) for request in requests]


# The shared behaviour (retry, limiter, counters, masked errors) lives in OpenAICompatClient: it is tested once here,
# through each subclass.
@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_429_is_retried_after_the_server_asks_and_then_succeeds(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(429, headers={"retry-after": "3"}), ok(kind)], requests, clock)

    call(kind, client)

    assert len(requests) == 2
    assert clock.slept == [3.0]
    assert client.stats() == {"calls": 1, "rate_limited": 1, "failed": 0}


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_429_backs_off_exponentially_without_retry_after(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(429) for _ in range(4)] + [ok(kind)], requests, clock)

    call(kind, client)

    assert len(requests) == 5
    assert clock.slept == [2.0, 4.0, 8.0, 16.0]
    assert client.stats() == {"calls": 1, "rate_limited": 4, "failed": 0}


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_retry_after_larger_than_the_backoff_wins_and_a_smaller_one_does_not_shorten_it(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(429, headers={"retry-after": "1"}),
                          httpx.Response(429, headers={"retry-after": "10"}), ok(kind)], requests, clock)

    call(kind, client)

    assert clock.slept == [2.0, 10.0]  # max(1, 2), then max(10, 4)


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_five_429_fail_with_a_clear_error(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(429) for _ in range(5)], requests, clock)

    with pytest.raises(ModelUnavailable, match="429") as info:
        call(kind, client)

    assert "5 attempts" in str(info.value)
    assert len(requests) == 5
    assert clock.slept == [2.0, 4.0, 8.0, 16.0]
    assert client.stats() == {"calls": 1, "rate_limited": 5, "failed": 1}


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_a_success_after_two_429_returns_the_value(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(429), httpx.Response(429), ok(kind)], requests, clock)

    result = call(kind, client)

    assert result == ("ok" if kind == "chat" else [1.0])
    assert clock.slept == [2.0, 4.0]
    assert client.stats() == {"calls": 1, "rate_limited": 2, "failed": 0}


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_retry_after_is_capped_at_30_seconds(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(429, headers={"retry-after": "120"}), ok(kind)], requests, clock)

    call(kind, client)

    assert clock.slept == [30.0]


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_a_retry_waits_for_a_slot_like_the_first_attempt(kind):
    clock, requests = FakeClock(), []
    limiter = RateLimiter(1, burst=1, sleep=clock.sleep, now=clock.now)  # one request a minute, no burst
    client = build(kind, [httpx.Response(429, headers={"retry-after": "1"}), ok(kind)], requests, clock,
                   limiter=limiter)

    call(kind, client)

    assert len(requests) == 2
    assert clock.slept == [2.0, pytest.approx(58.0)]  # the backoff sleep (2 beats retry-after 1), then the wait for the token


def test_chat_and_embeddings_sharing_a_limiter_space_their_calls_together():
    clock, requests = FakeClock(), []
    limiter = RateLimiter(2, burst=2, sleep=clock.sleep, now=clock.now)  # two requests a minute, for both clients
    chat = build("chat", [ok("chat"), ok("chat")], requests, clock, limiter=limiter)
    embeddings = build("embeddings", [ok("embeddings")], requests, clock, limiter=limiter)

    call("chat", chat)
    call("embeddings", embeddings)
    call("chat", chat)

    assert len(requests) == 3
    assert clock.slept == [pytest.approx(30.0)]  # the bucket is empty after two calls: the third waits 60 / 2 s for a token


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_an_error_names_the_status_and_never_shows_the_key(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(500, text=f"bad token {KEY} rejected")], requests, clock)

    with pytest.raises(ModelUnavailable) as info:
        call(kind, client)

    message = str(info.value)
    assert "500" in message
    assert KEY not in message
    assert "bad token *** rejected" in message
    assert client.stats()["failed"] == 1


@pytest.mark.parametrize("kind", ["chat", "embeddings"])
def test_the_error_text_is_cut_to_200_characters(kind):
    clock, requests = FakeClock(), []
    client = build(kind, [httpx.Response(400, text="x" * 500)], requests, clock)

    with pytest.raises(ModelUnavailable) as info:
        call(kind, client)

    assert str(info.value).endswith("x" * 200)
    assert "x" * 201 not in str(info.value)


def test_chat_sends_the_bearer_key_the_schema_and_the_extra_body():
    requests = []
    clock = FakeClock()
    client = OpenAICompatChat(BASE, KEY, extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                              max_tokens=200, timeout_s=5,
                              transport=httpx.MockTransport(handler([httpx.Response(200, json=chat_reply("done"))],
                                                                    requests)),
                              sleep=clock.sleep)

    reply = client.generate("hi", model="m", temperature=0.0, seed=7, max_tokens=None, response_format=SCHEMA)

    request = requests[0]
    assert str(request.url) == "https://cloud.example/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == "m"
    assert body["messages"] == [{"role": "user", "content": "hi"}]
    assert body["temperature"] == 0.0
    assert body["seed"] == 7
    assert body["max_tokens"] == 200  # the client's cap, since the call gave none
    assert body["response_format"] == {
        "type": "json_schema", "json_schema": {"name": "reply", "schema": SCHEMA, "strict": True},
    }
    assert body["chat_template_kwargs"] == {"enable_thinking": False}
    assert reply == "done"


def test_seed_and_temperature_are_left_out_when_not_given():
    requests = []
    clock = FakeClock()
    client = build("chat", [ok("chat")], requests, clock)

    client.generate("hi", model="m", temperature=None, seed=None, max_tokens=50)

    body = bodies(requests)[0]
    assert "seed" not in body
    assert "temperature" not in body
    assert body["max_tokens"] == 50


def test_a_langchain_prompt_becomes_one_message_per_turn_with_the_chat_roles():
    requests = []
    clock = FakeClock()
    client = build("chat", [ok("chat")], requests, clock)
    prompt = ChatPromptTemplate.from_messages([("system", "rules"), ("human", "ask: {ask}")]).invoke({"ask": "price"})

    client.generate(prompt, model="m", temperature=None, seed=None, max_tokens=None)

    assert bodies(requests)[0]["messages"] == [
        {"role": "system", "content": "rules"},
        {"role": "user", "content": "ask: price"},
    ]


def test_stream_yields_the_whole_reply_as_one_piece():
    requests = []
    client = build("chat", [httpx.Response(200, json=chat_reply("whole reply"))], requests, FakeClock())

    assert list(client.stream("hi", model="m", temperature=None, seed=None, max_tokens=None)) == ["whole reply"]


def test_documents_are_sent_as_passages_and_questions_as_queries():
    requests = []
    client = build("embeddings", [httpx.Response(200, json=embed_reply([[1.0], [2.0]])),
                                  httpx.Response(200, json=embed_reply([[3.0]]))], requests, FakeClock())

    documents = client.embed_documents(["a", "b"])
    query = client.embed_query("q")

    first, second = bodies(requests)
    assert str(requests[0].url) == "https://cloud.example/v1/embeddings"
    assert requests[0].headers["authorization"] == f"Bearer {KEY}"
    assert first == {"model": "embed-model", "input": ["a", "b"], "input_type": "passage", "truncate": "END",
                     "encoding_format": "float"}
    assert second["input_type"] == "query"
    assert second["input"] == ["q"]
    assert documents == [[1.0], [2.0]]
    assert query == [3.0]


def test_forty_texts_go_in_three_batches_and_come_back_in_their_order():
    def batch_reply(start, size):
        # the server answers the batch in reverse: the client must sort by index
        return httpx.Response(200, json={"data": [{"index": i, "embedding": [float(start + i)]}
                                                  for i in reversed(range(size))]})

    requests = []
    client = build("embeddings", [batch_reply(0, 16), batch_reply(16, 16), batch_reply(32, 8)], requests, FakeClock())

    vectors = client.embed_documents([f"text {i}" for i in range(40)])

    assert [len(body["input"]) for body in bodies(requests)] == [16, 16, 8]
    assert vectors == [[float(i)] for i in range(40)]


def test_the_two_clients_are_the_shared_base_and_their_protocol():
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    chat = OpenAICompatChat(BASE, KEY, timeout_s=5, transport=transport)
    embeddings = OpenAICompatEmbeddings(BASE, KEY, "embed-model", timeout_s=5, transport=transport)

    assert isinstance(chat, OpenAICompatClient)
    assert isinstance(embeddings, OpenAICompatClient)
    assert TextGenerator in OpenAICompatChat.__mro__  # the protocols are not runtime_checkable: check the bases
    assert EmbeddingProvider in OpenAICompatEmbeddings.__mro__
