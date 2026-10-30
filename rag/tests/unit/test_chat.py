from types import SimpleNamespace

import pytest

from assistant import chat
from assistant.index import IndexUnavailable
from assistant.settings import SettingsError

REASON = 'the index of strategy "section" has not been built yet; run: python -m assistant.ingest section'


@pytest.fixture
def session(monkeypatch):
    """Replaces the configuration, the index check and the composition root, and scripts what the user types."""
    state = SimpleNamespace(typed=[], asked=[], checked=[], built_with=[], pieces=["Braces ", "cost $180."])

    def fake_input(prompt):
        if not state.typed:
            pytest.fail("the chat asked for more input than the test scripted")
        return state.typed.pop(0)

    class FakeService:
        def __init__(self, config):
            state.built_with.append(config)

        def stream_answer(self, question):
            state.asked.append(question)
            yield from state.pieces

    monkeypatch.setattr(chat, "RagConfig", lambda: SimpleNamespace(strategy="section"))
    monkeypatch.setattr(chat, "get_strategy", lambda name: f"strategy:{name}")
    monkeypatch.setattr(chat, "require_index", lambda strategy: state.checked.append(strategy))
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


def test_a_question_streams_the_answer_and_then_the_chat_closes(session, capsys):
    session.typed.extend(["How much are braces?", "exit"])

    result = chat.to_ask()

    assert result == 0
    assert session.asked == ["How much are braces?"]
    assert session.built_with[0].strategy == "section"
    assert session.checked == ["strategy:section"]
    out = capsys.readouterr().out
    assert "response: Braces cost $180.\n\n" in out
    assert "Closing the assistant. See you!" in out


def test_a_model_error_during_a_question_ends_the_chat(session, monkeypatch):
    class FailingService:
        def __init__(self, config):
            pass

        def stream_answer(self, question):
            raise ConnectionError("Ollama is not running")

    monkeypatch.setattr(chat, "build_rag_service", FailingService)
    session.typed.extend(["How much are braces?", "exit"])

    with pytest.raises(ConnectionError, match="Ollama is not running"):
        chat.to_ask()

    assert session.typed == ["exit"]  # the loop stopped before reading the next line
