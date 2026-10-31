import json

import pytest

from assistant import index
from assistant.settings import Strategy

SECTION = Strategy("section", "section", {"max_chars": 1200, "overlap": 100})


def create(tmp_path, strategy=SECTION, source="pdf-1", model="nomic-embed-text"):
    manifest = index.write_manifest(strategy, 11, base=tmp_path, source=source, embedding_model=model)
    index.chunks_path(strategy.name, tmp_path).write_text("[]", encoding="utf-8")
    return manifest


def state(tmp_path, strategy=SECTION, source="pdf-1", model="nomic-embed-text"):
    return index.index_state(strategy, base=tmp_path, source=source, embedding_model=model)


def test_each_strategy_has_its_own_directory(tmp_path):
    assert index.index_dir("section", tmp_path) == tmp_path / "section"
    assert index.chroma_dir("page", tmp_path) == tmp_path / "page" / "chroma"
    assert index.chunks_path("page", tmp_path) == tmp_path / "page" / "chunks.json"
    assert index.manifest_path("page", tmp_path) == tmp_path / "page" / "manifest.json"


def test_manifest_records_the_embedding_dimensions_when_they_are_known(tmp_path):
    manifest = index.write_manifest(
        SECTION, 11, base=tmp_path, source="pdf-1", embedding_model="nomic-embed-text", embedding_dimensions=768,
    )

    assert manifest["embedding_dimensions"] == 768
    saved = json.loads((tmp_path / "section" / "manifest.json").read_text(encoding="utf-8"))
    assert saved["embedding_dimensions"] == 768


def test_index_without_recorded_dimensions_is_still_current(tmp_path):
    create(tmp_path)  # manifests written before the dimensions were recorded have no such field

    assert "embedding_dimensions" not in json.loads((tmp_path / "section" / "manifest.json").read_text(encoding="utf-8"))
    assert state(tmp_path) == (index.CURRENT, None)


class CountingEmbeddings:
    """Stands in for the embedding model: answers with a vector of the given size, or fails, and records the questions."""

    def __init__(self, size=None, error=None):
        self.size, self.error, self.questions = size, error, []

    def embed_query(self, text):
        self.questions.append(text)
        if self.error is not None:
            raise self.error
        return [0.0] * self.size


def write_dimensions(tmp_path, dimensions):
    index.write_manifest(SECTION, 11, base=tmp_path, source="pdf-1", embedding_model="nomic-embed-text",
                         embedding_dimensions=dimensions)


def test_dimension_check_asks_nothing_without_a_manifest(tmp_path):
    embeddings = CountingEmbeddings(size=3)

    index.check_embedding_dimensions(SECTION, embeddings, base=tmp_path)

    assert embeddings.questions == []


def test_dimension_check_skips_an_index_built_without_the_field(tmp_path):
    create(tmp_path)
    embeddings = CountingEmbeddings(size=3)

    index.check_embedding_dimensions(SECTION, embeddings, base=tmp_path)

    assert embeddings.questions == []


def test_dimension_check_passes_when_the_sizes_agree(tmp_path):
    write_dimensions(tmp_path, 1024)
    embeddings = CountingEmbeddings(size=1024)

    index.check_embedding_dimensions(SECTION, embeddings, base=tmp_path)

    assert embeddings.questions == ["dimension check"]


def test_dimension_check_refuses_a_model_of_another_size(tmp_path):
    write_dimensions(tmp_path, 1024)

    with pytest.raises(index.IndexUnavailable) as info:
        index.check_embedding_dimensions(SECTION, CountingEmbeddings(size=768), base=tmp_path)

    assert str(info.value) == (
        'the embedding model returns 768 dimensions but the index of strategy "section" was built with 1024; '
        "run: python -m assistant.ingest section"
    )


def test_dimension_check_ignores_a_model_that_does_not_answer(tmp_path):
    write_dimensions(tmp_path, 1024)

    index.check_embedding_dimensions(
        SECTION, CountingEmbeddings(error=ConnectionError("Ollama is not running")), base=tmp_path,
    )


def test_manifest_records_how_the_index_was_built(tmp_path):
    manifest = create(tmp_path)

    saved = json.loads((tmp_path / "section" / "manifest.json").read_text(encoding="utf-8"))
    assert saved == manifest
    assert set(saved) == {"strategy", "definition_hash", "source_hash", "embedding_model", "chunk_count", "created_at"}
    assert saved["strategy"] == "section"
    assert saved["definition_hash"] == SECTION.definition_hash()
    assert saved["chunk_count"] == 11


def test_missing_index(tmp_path):
    status, reason = state(tmp_path)

    assert status == index.MISSING
    assert "python -m assistant.ingest section" in reason


def test_directory_without_manifest_is_missing(tmp_path):
    (tmp_path / "section").mkdir()

    assert state(tmp_path)[0] == index.MISSING


def test_manifest_without_chunks_is_missing(tmp_path):
    index.write_manifest(SECTION, 11, base=tmp_path, source="pdf-1", embedding_model="nomic-embed-text")

    assert state(tmp_path)[0] == index.MISSING


def test_current_index(tmp_path):
    create(tmp_path)

    assert state(tmp_path) == (index.CURRENT, None)


@pytest.mark.parametrize(
    "change, expected",
    [
        ({"strategy": Strategy("section", "section", {"max_chars": 800, "overlap": 100})}, "strategy definition"),
        ({"source": "pdf-2"}, "brochure changed"),
        ({"model": "bge-m3"}, "embedding model"),
    ],
)
def test_stale_index(tmp_path, change, expected):
    create(tmp_path)

    status, reason = state(tmp_path, **change)

    assert status == index.STALE
    assert expected in reason
    assert "python -m assistant.ingest section" in reason


def test_writing_one_index_does_not_touch_another(tmp_path):
    page = Strategy("page", "page", {})
    create(tmp_path)
    before = (tmp_path / "section" / "manifest.json").read_bytes()

    create(tmp_path, strategy=page)

    assert (tmp_path / "section" / "manifest.json").read_bytes() == before
    assert state(tmp_path, strategy=page) == (index.CURRENT, None)


def test_require_index_raises_with_the_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(index, "source_hash", lambda path=None: "pdf-1")

    with pytest.raises(index.IndexUnavailable, match="has not been built yet"):
        index.require_index(SECTION, base=tmp_path)

    index.write_manifest(SECTION, 11, base=tmp_path)
    index.chunks_path("section", tmp_path).write_text("[]", encoding="utf-8")
    index.require_index(SECTION, base=tmp_path)
