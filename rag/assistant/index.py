"""Where the index of each strategy lives and whether it still matches the declared strategy and the brochure."""
import hashlib
import json
from datetime import datetime
from pathlib import Path

from assistant.config import INDEX_DIR, OLLAMA_EMBEDDING_MODEL, SOURCE_PDF

CURRENT, STALE, MISSING = "current", "stale", "missing"


class IndexUnavailable(Exception):
    """The index of a strategy is missing or out of date. The message carries the command that fixes it."""


def index_dir(name, base=None):
    return Path(base or INDEX_DIR) / name


def chroma_dir(name, base=None):
    return index_dir(name, base) / "chroma"


def chunks_path(name, base=None):
    return index_dir(name, base) / "chunks.json"


def manifest_path(name, base=None):
    return index_dir(name, base) / "manifest.json"


def source_hash(path=SOURCE_PDF):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


def ingest_command(name):
    return f"python -m assistant.ingest {name}"


def write_manifest(strategy, chunk_count, base=None, source=None, embedding_model=None):
    """Records which definition, brochure, and model the index was built with."""
    manifest = {
        "strategy": strategy.name,
        "definition_hash": strategy.definition_hash(),
        "source_hash": source or source_hash(),
        "embedding_model": embedding_model or OLLAMA_EMBEDDING_MODEL,
        "chunk_count": chunk_count,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    path = manifest_path(strategy.name, base)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def read_manifest(name, base=None):
    path = manifest_path(name, base)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None


def index_state(strategy, base=None, source=None, embedding_model=None):
    """Returns (state, reason). The reason is None when the index is current."""
    manifest = read_manifest(strategy.name, base)
    command = ingest_command(strategy.name)
    if manifest is None or not chunks_path(strategy.name, base).is_file():
        return MISSING, f"the index of strategy \"{strategy.name}\" has not been built yet; run: {command}"

    changed = []
    if manifest.get("definition_hash") != strategy.definition_hash():
        changed.append("the strategy definition changed")
    if manifest.get("source_hash") != (source or source_hash()):
        changed.append("the brochure changed")
    if manifest.get("embedding_model") != (embedding_model or OLLAMA_EMBEDDING_MODEL):
        changed.append("the embedding model changed")
    if changed:
        return STALE, (
            f"the index of strategy \"{strategy.name}\" is out of date ({' and '.join(changed)}); run: {command}"
        )
    return CURRENT, None


def require_index(strategy, base=None):
    """Raises IndexUnavailable if the index cannot be used."""
    state, reason = index_state(strategy, base)
    if state != CURRENT:
        raise IndexUnavailable(reason)
