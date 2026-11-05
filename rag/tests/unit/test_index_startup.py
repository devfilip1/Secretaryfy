"""The startup rule of the server with the Node knowledge: an index that only lags behind unpublished edits still serves."""
import pytest

from assistant import index
from assistant.index import IndexUnavailable, index_changes, require_index_for_http_source
from assistant.ingestion.http_source import KnowledgeUnavailable
from assistant.settings import Strategy, get_strategy

STRATEGY = Strategy("section", "section", {"max_chars": 1200, "overlap": 100})
URL = "http://127.0.0.1:3000/internal/knowledge"
DOWN = KnowledgeUnavailable(f"could not reach the knowledge server at {URL}: refused")


class FakeKnowledge:
    def __init__(self, version="v2", error=None):
        self.value, self.error = version, error

    def version(self):
        if self.error is not None:
            raise self.error
        return self.value


@pytest.fixture
def indexes(monkeypatch, tmp_path):
    monkeypatch.setattr(index, "INDEX_DIR", tmp_path)
    return tmp_path


def write_index(base, strategy=STRATEGY, source="v1", model=None):
    index.write_manifest(strategy, 3, base=base, source=source, embedding_model=model)
    index.chunks_path(strategy.name, base).write_text("[]", encoding="utf-8")


def test_a_missing_index_refuses_to_start_even_with_a_knowledge_server(indexes):
    with pytest.raises(IndexUnavailable, match="has not been built yet"):
        require_index_for_http_source(STRATEGY, FakeKnowledge(), indexes)


def test_an_index_built_from_the_published_knowledge_starts_without_a_warning(indexes):
    write_index(indexes, source="v2")

    assert require_index_for_http_source(STRATEGY, FakeKnowledge("v2"), indexes) is None


def test_unpublished_knowledge_starts_with_one_warning_naming_the_unpublished_changes(indexes):
    write_index(indexes, source="v1")

    warning = require_index_for_http_source(STRATEGY, FakeKnowledge("v2"), indexes)

    assert warning is not None
    assert "unpublished changes" in warning
    assert "\n" not in warning


def test_an_unreachable_knowledge_server_starts_with_its_message_when_an_index_exists(indexes):
    write_index(indexes, source="v1")

    warning = require_index_for_http_source(STRATEGY, FakeKnowledge(error=DOWN), indexes)

    assert warning is not None
    assert URL in warning
    assert "last published index" in warning


def test_a_changed_strategy_definition_refuses_even_when_only_the_knowledge_is_unreachable(indexes):
    write_index(indexes, strategy=Strategy("section", "section", {"max_chars": 900, "overlap": 100}))

    with pytest.raises(IndexUnavailable, match="strategy definition changed"):
        require_index_for_http_source(STRATEGY, FakeKnowledge(error=DOWN), indexes)


def test_a_changed_strategy_definition_refuses_with_unpublished_knowledge(indexes):
    write_index(indexes, strategy=Strategy("section", "section", {"max_chars": 900, "overlap": 100}), source="v1")

    with pytest.raises(IndexUnavailable, match="strategy definition changed"):
        require_index_for_http_source(STRATEGY, FakeKnowledge("v2"), indexes)


def test_a_changed_embedding_model_refuses_even_when_the_knowledge_is_unreachable(indexes):
    write_index(indexes, model="another-embedding-model")

    with pytest.raises(IndexUnavailable, match="embedding model changed"):
        require_index_for_http_source(STRATEGY, FakeKnowledge(error=DOWN), indexes)


def test_index_changes_names_only_what_differs(indexes):
    write_index(indexes, source="v1")

    assert index_changes(STRATEGY, indexes, source="v2") == (index.STALE, [index.SOURCE_CHANGED])
    assert index_changes(STRATEGY, indexes, compare_source=False) == (index.CURRENT, [])
    assert index_changes(STRATEGY, indexes, source="v1") == (index.CURRENT, [])


def test_the_strict_file_rule_refuses_a_stale_index(monkeypatch, indexes):
    write_index(indexes, source="v1")
    monkeypatch.setattr(index, "source_hash", lambda: "v2")

    with pytest.raises(IndexUnavailable, match="knowledge source changed"):
        index.require_index(STRATEGY, indexes)


def test_the_strategy_of_the_config_is_the_section_strategy():
    assert get_strategy("section").name == STRATEGY.name
