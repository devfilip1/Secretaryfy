"""A reindex that another process finishes is seen by this process without a restart. Real Chroma, no Ollama.

The indexes live in tmp_path: the chroma folder is redirected and every path takes the base folder explicitly.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from langchain_core.documents import Document

from assistant.index import chunks_path, index_version, manifest_path
from assistant.retrieval.chunks import JsonChunkSource
from assistant.retrieval.lexical import LexicalIndex
from assistant.storage import chroma as chroma_store

ROOT = Path(__file__).parents[2]
STRATEGY = "section"

# The second process: it rewrites the index the way assistant.ingest does (chunks, then Chroma, then manifest).
REINDEX_SCRIPT = r'''
import json, os, sys
from pathlib import Path
from langchain_core.documents import Document
from assistant.index import chunks_path, manifest_path
from assistant.storage import chroma

base, texts = Path(sys.argv[1]), json.loads(sys.argv[2])


def vector(text):
    return [float(len(text)), float(sum(map(ord, text)) % 101), 1.0]


class FakeEmbeddings:
    def embed_documents(self, items):
        return [vector(item) for item in items]

    def embed_query(self, item):
        return vector(item)


chroma.chroma_dir = lambda name: base / name / "chroma"
chunks_path("section", base).parent.mkdir(parents=True, exist_ok=True)
chunks_path("section", base).write_text(
    json.dumps([{"content": text, "metadata": {}} for text in texts], ensure_ascii=False), encoding="utf-8"
)
provider = chroma.ChromaVectorStoreProvider(embeddings=FakeEmbeddings(), version=lambda name: None)
provider("section").rebuild([Document(page_content=text) for text in texts])
manifest = manifest_path("section", base)
manifest.write_text(json.dumps({"strategy": "section", "embedding_dimensions": 3}), encoding="utf-8")
later = manifest.stat().st_mtime_ns + 1_000_000_000
os.utime(manifest, ns=(later, later))
'''


def vector(text):
    return [float(len(text)), float(sum(map(ord, text)) % 101), 1.0]


class FakeEmbeddings:
    def embed_documents(self, items):
        return [vector(item) for item in items]

    def embed_query(self, item):
        return vector(item)


def test_a_reindex_by_another_process_is_seen_without_restarting(monkeypatch, tmp_path):
    base = tmp_path
    v1 = ["Braces cost 180 dollars", "Whitening costs 45"]
    v2 = ["Braces stay on for 12 to 36 months", "Implants take 3 to 6 months", "Cleaning is 40 dollars"]
    monkeypatch.setattr(chroma_store, "chroma_dir", lambda name: base / name / "chroma")
    provider = chroma_store.ChromaVectorStoreProvider(
        embeddings=FakeEmbeddings(), version=lambda name: index_version(name, base),
    )
    lexical = LexicalIndex(JsonChunkSource(base))

    # this process builds v1 the way the ingestion does and reads it
    chunks_path(STRATEGY, base).parent.mkdir(parents=True, exist_ok=True)
    chunks_path(STRATEGY, base).write_text(
        json.dumps([{"content": text, "metadata": {}} for text in v1], ensure_ascii=False), encoding="utf-8"
    )
    provider(STRATEGY).rebuild([Document(page_content=text) for text in v1])
    manifest_path(STRATEGY, base).write_text(json.dumps({"strategy": STRATEGY, "embedding_dimensions": 3}), encoding="utf-8")
    assert lexical.get(STRATEGY)[1] == v1
    assert set(provider(STRATEGY).vectors_by_content()) == set(v1)

    # another process rewrites the index while this one keeps running
    subprocess.run(
        [sys.executable, "-c", REINDEX_SCRIPT, str(base), json.dumps(v2)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )

    assert lexical.get(STRATEGY)[1] == v2
    assert set(provider(STRATEGY).vectors_by_content()) == set(v2)
