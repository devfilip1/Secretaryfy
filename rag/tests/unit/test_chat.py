from types import SimpleNamespace

import pytest

from assistant import chat
from assistant.index import IndexUnavailable
from assistant.settings import SettingsError

REASON = 'the index of strategy "section" has not been built yet; run: python -m assistant.ingest section'
DIMENSIONS = 'the embedding model returns 768 dimensions but the index of strategy "section" was built with 1024; run: python -m assistant.ingest section'


@pytest.fixture
def session(monkeypatch):
    """Replaces the configuration, the index checks and the composition root, and scripts what the user types."""
    state = SimpleNamespace(typed=[], asked=[], checked=[], built_with=[], reply="Braces cost $180.")

    def fake_input(prompt):
        if not state.typed:
            pytest.fail("the chat asked for more input than the test scripted")
        return state.typed.pop(0)

    class FakeService:
        def __init__(self, config):
            state.built_with.append(config)

        def answer(self, question, history=None):
            state.asked.append(question)
            return SimpleNamespace(answer=state.reply)

    monkeypatch.setattr(chat, "RagConfig", lambda: SimpleNamespace(strategy="section"))
    monkeypatch.setattr(chat, "get_strategy", lambda name: f"strategy:{name}")
    monkeypatch.setattr(chat, "require_index", lambda strategy: state.checked.append(strategy))
    monkeypatch.setattr(chat, "build_embeddings_provider", lambda: "embeddings")
    monkeypatch.setattr(chat, "check_embedding_dimensions", lambda strategy, embeddings: None)
    monkeypatch.setattr(chat, "build_rag_service", FakeService)
    monkeypatch.setattr("builtins.input", fake_input)
    return state


def test_invalid_configuration_is_listed_and_the_chat_does_not_start(session, monkeypatch, capsys):
    def invalid():
        raise SettingsError(["experiments.yaml: first problem", "strategies.yaml: second problem"])

    monkeypatch.setattr(chat, "RagConfig", invalid)
    session.typed.append("exit")

    result = chat.to_ask()

    assert result == 2
    assert capsys.readouterr().out == (
        "Invalid configuration: 2 problem(s)\n"
        "  - experiments.yaml: first problem\n"
        "  - strategies.yaml: second problem\n"
    )
    assert session.typed == ["exit"]  # the chat never asked for input


def test_unusable_index_is_reported_and_the_chat_does_not_start(session, monkeypatch, capsys):
    def unavailable(strategy):
        raise IndexUnavailable(REASON)

    monkeypatch.setattr(chat, "require_index", unavailable)
    session.typed.append("exit")

    result = chat.to_ask()

    assert result == 1
    assert capsys.readouterr().out == f"Could not start: {REASON}\n"
    assert session.typed == ["exit"]


def test_embedding_dimensions_that_differ_from_the_index_stop_the_chat(session, monkeypatch, capsys):
    def mismatched(strategy, embeddings):
        raise IndexUnavailable(DIMENSIONS)

    monkeypatch.setattr(chat, "check_embedding_dimensions", mismatched)
    session.typed.append("exit")

    result = chat.to_ask()

    assert result == 1
    assert capsys.readouterr().out == f"Could not start: {DIMENSIONS}\n"
    assert session.typed == ["exit"]


def test_the_dimension_check_uses_the_embeddings_of_the_composition_root(session, monkeypatch):
    seen = []
    monkeypatch.setattr(chat, "check_embedding_dimensions", lambda strategy, embeddings: seen.append((strategy, embeddings)))
    session.typed.append("exit")

    chat.to_ask()

    assert seen == [("strategy:section", "embeddings")]


@pytest.mark.parametrize("word", ["exit", "quit", "EXIT", "Quit"])
def test_exit_or_quit_in_any_case_closes_the_chat(session, capsys, word):
    session.typed.append(word)

    result = chat.to_ask()

    assert result == 0
    assert "Closing the assistant. See you!" in capsys.readouterr().out
    assert session.asked == []


def test_blank_lines_are_skipped_without_asking_the_model(session, capsys):
    session.typed.extend(["", "   ", "exit"])

    result = chat.to_ask()

    assert result == 0
    assert session.asked == []
    assert "response:" not in capsys.readouterr().out


def test_a_question_is_answered_in_full_and_then_the_chat_closes(session, capsys):
    session.typed.extend(["How much are braces?", "exit"])

    result = chat.to_ask()

    assert result == 0
    assert session.asked == ["How much are braces?"]
    assert session.built_with[0].strategy == "section"
    assert session.checked == ["strategy:section"]
    out = capsys.readouterr().out
    assert "response: Braces cost $180.\n\n" in out
    assert "Closing the assistant. See you!" in out


def test_the_chat_prints_the_answer_the_service_returns_already_cleaned(session, capsys):
    # The service applies clean_answer; the chat prints what it gets, so a note the model added does not show.
    session.reply = "Braces cost $180."
    session.typed.extend(["How much are braces?", "exit"])

    chat.to_ask()

    assert "Note" not in capsys.readouterr().out


def test_the_chat_asks_for_the_full_answer_not_the_stream(session, monkeypatch):
    class StreamOnlyService:
        def __init__(self, config):
            pass

        def stream_answer(self, question):
            raise AssertionError("the chat must not stream")

        def answer(self, question, history=None):
            return SimpleNamespace(answer="Braces cost $180.")

    monkeypatch.setattr(chat, "build_rag_service", StreamOnlyService)
    session.typed.extend(["How much are braces?", "exit"])

    assert chat.to_ask() == 0


def test_a_failed_answer_is_reported_and_the_chat_keeps_going(session, monkeypatch, capsys):
    attempts = []

    class FlakyService:
        def __init__(self, config):
            pass

        def answer(self, question, history=None):
            attempts.append(question)
            if len(attempts) == 1:
                raise ConnectionError("Ollama is not running")
            return SimpleNamespace(answer="Braces cost $180.")

    monkeypatch.setattr(chat, "build_rag_service", FlakyService)
    session.typed.extend(["How much are braces?", "How much are braces?", "exit"])

    result = chat.to_ask()

    out = capsys.readouterr().out
    assert result == 0
    assert "\nCould not get an answer: Ollama is not running\n\n" in out
    assert "response: Braces cost $180.\n\n" in out
    assert attempts == ["How much are braces?", "How much are braces?"]
    assert session.typed == []


def test_interrupting_a_question_is_not_swallowed(session, monkeypatch):
    class InterruptedService:
        def __init__(self, config):
            pass

        def answer(self, question, history=None):
            raise KeyboardInterrupt

    monkeypatch.setattr(chat, "build_rag_service", InterruptedService)
    session.typed.append("How much are braces?")

    with pytest.raises(KeyboardInterrupt):
        chat.to_ask()
