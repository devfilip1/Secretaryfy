"""Tests that use Ollama and the real indexes. Run with: pytest -m integration"""
import builtins
import importlib
import json
import sys

import pytest

pytestmark = pytest.mark.integration


def test_import_has_no_side_effects(monkeypatch):
    def fail(*args, **kwargs):
        raise AssertionError("an import must not open the chat or call the model")

    monkeypatch.setattr(builtins, "input", fail)
    monkeypatch.setattr("langchain_ollama.ChatOllama.invoke", fail)
    monkeypatch.setattr("langchain_ollama.OllamaEmbeddings.embed_query", fail)
    monkeypatch.setattr("langchain_ollama.OllamaEmbeddings.embed_documents", fail)
    names = ("assistant.config", "assistant.settings", "assistant.index", "assistant.ingest", "assistant.pipeline",
             "assistant.chat")
    for name in names:
        sys.modules.pop(name, None)

    for name in names:
        importlib.import_module(name)


def test_every_index_matches_its_strategy_and_the_current_brochure():
    """If it fails, some index is missing or out of date: run python -m assistant.ingest."""
    from assistant.index import CURRENT, chunks_path, index_state
    from assistant.ingest import build_chunks, load_pages
    from assistant.settings import strategies

    pages = load_pages()
    for strategy in strategies():
        assert index_state(strategy) == (CURRENT, None), strategy.name
        expected = [chunk.page_content for chunk in build_chunks(strategy, pages)]
        with open(chunks_path(strategy.name), encoding="utf-8") as f:
            indexed = [chunk["content"] for chunk in json.load(f)]
        assert indexed == expected, strategy.name


def test_vector_search_by_vector_matches_search_by_text():
    """The pipeline searches with the vector already computed; the order must be the same as searching by text."""
    from assistant import pipeline
    from assistant.pipeline import RagConfig, retrieve

    config = RagConfig()
    questions = ["How much is teeth whitening?", "How long does an implant take?", "how long do braces stay on",
                 "Do you have payment options?", "What is the clinic's address?"]
    for question in questions:
        by_text = pipeline._db(config.strategy).similarity_search(question, k=config.vector_k)
        result = retrieve(question, config)

        assert [chunk.content for chunk in result.vector] == [doc.page_content for doc in by_text], question
        assert all(0 < chunk.similarity <= 1 for chunk in result.fused), question
        # the similarity goes down with the position in the vector search
        similarities = [chunk.similarity for chunk in result.vector]
        assert similarities == sorted(similarities, reverse=True), question


def test_answers_a_price_from_the_right_procedure():
    from assistant.pipeline import RagConfig, answer

    result = answer("How much is a dental cleaning?", RagConfig())

    assert "$40" in result.answer and "$85" in result.answer
    assert "$50" not in result.answer and "$140" not in result.answer  # the filling's price
    assert any("Dental Cleaning" in chunk.content for chunk in result.retrieval.fused)


def test_answers_the_clinic_hours():
    from assistant.pipeline import RagConfig, answer

    result = answer("What are your opening hours on Saturday?", RagConfig())

    assert "9:00 AM" in result.answer and "2:00 PM" in result.answer
    assert any("Clinic Information" in chunk.content for chunk in result.retrieval.fused)


def test_answers_in_english_a_question_in_another_language():
    from assistant.pipeline import RagConfig, answer
    from evaluation.answer_metrics import check_rules

    result = answer("Quanto custa a limpeza dental?", RagConfig())

    assert "$40" in result.answer and "$85" in result.answer
    assert "not_english" not in check_rules(result.answer)


def test_refuses_what_is_not_in_the_brochure():
    from assistant.pipeline import NO_ANSWER, RagConfig, answer

    assert NO_ANSWER in answer("Do you accept dental insurance?", RagConfig()).answer


def test_stream_yields_the_same_kind_of_answer():
    from assistant.pipeline import RagConfig, stream_answer

    text = "".join(stream_answer("How much is a dental cleaning?", RagConfig()))

    assert "$40" in text and "$85" in text


def test_hyde_generates_a_short_hypothetical_answer():
    from assistant.pipeline import RagConfig, hypothetical_answer

    text = hypothetical_answer("How much is a dental implant?", RagConfig())

    assert 10 < len(text) < 600


def test_chat_refuses_to_start_without_the_index(monkeypatch, tmp_path, capsys):
    from assistant import chat, index

    monkeypatch.setattr(index, "INDEX_DIR", tmp_path)  # no index in this directory
    monkeypatch.setattr(builtins, "input", lambda *args: pytest.fail("the chat must not open without the index"))

    code = chat.to_ask()

    assert code == 1
    output = capsys.readouterr().out
    assert "has not been built yet" in output and "python -m assistant.ingest section" in output
