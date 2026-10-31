import json
import os

import pytest

from assistant.index import IndexUnavailable, chunks_path, index_version, manifest_path
from assistant.retrieval.chunks import JsonChunkSource


def write_chunks(base, name, contents):
    path = chunks_path(name, base)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([{"content": text, "metadata": {}} for text in contents], ensure_ascii=False), encoding="utf-8")
    return path


def write_manifest(base, name, mtime_ns):
    path = manifest_path(name, base)
    path.write_text("{}", encoding="utf-8")
    os.utime(path, ns=(mtime_ns, mtime_ns))
    return path


def test_chunks_are_the_texts_in_the_order_of_the_file(tmp_path):
    write_chunks(tmp_path, "section", ["alpha", "beta", "gamma"])

    assert JsonChunkSource(tmp_path).chunks("section") == ["alpha", "beta", "gamma"]


def test_version_is_the_manifest_modification_time_when_there_is_a_manifest(tmp_path):
    write_chunks(tmp_path, "section", ["alpha"])
    write_manifest(tmp_path, "section", 1_234_567_890_000_000_000)

    assert JsonChunkSource(tmp_path).version("section") == "1234567890000000000"


def test_version_falls_back_to_the_chunks_file_when_there_is_no_manifest(tmp_path):
    path = write_chunks(tmp_path, "section", ["alpha"])
    os.utime(path, ns=(777_000_000_000, 777_000_000_000))

    assert JsonChunkSource(tmp_path).version("section") == "777000000000"


def test_version_is_none_when_the_index_was_never_built(tmp_path):
    assert JsonChunkSource(tmp_path).version("section") is None


def test_chunks_of_an_index_never_built_say_how_to_build_it(tmp_path):
    with pytest.raises(IndexUnavailable) as info:
        JsonChunkSource(tmp_path).chunks("section")

    assert str(info.value) == (
        'the index of strategy "section" has not been built yet; run: python -m assistant.ingest section'
    )


def test_index_version_prefers_the_manifest_over_the_chunks(tmp_path):
    write_chunks(tmp_path, "section", ["alpha"])
    os.utime(chunks_path("section", tmp_path), ns=(100_000_000_000, 100_000_000_000))
    write_manifest(tmp_path, "section", 200_000_000_000)

    assert index_version("section", tmp_path) == "200000000000"


def test_index_version_is_none_without_files(tmp_path):
    assert index_version("section", tmp_path) is None
