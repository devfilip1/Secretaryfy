"""Where the index of each strategy lives and whether it still matches the declared strategy and the knowledge source."""
import json
from datetime import datetime
from pathlib import Path

from assistant.config import INDEX_DIR, OLLAMA_EMBEDDING_MODEL
from assistant.ingestion.http_source import KnowledgeUnavailable

CURRENT, STALE, MISSING, UNKNOWN = "current", "stale", "missing", "unknown"  # UNKNOWN: the knowledge source cannot be read

DEFINITION_CHANGED = "the strategy definition changed"
SOURCE_CHANGED = "the knowledge source changed"
MODEL_CHANGED = "the embedding model changed"


class EmbeddingMismatch(Exception):
    """The embedding model gives vectors of another size than the index. The message carries the command that fixes it."""


class IndexUnavailable(Exception):
    """The index of a strategy is missing or out of date. The message carries the command that fixes it."""


class IndexInconsistent(Exception):
    """The chunks file and the vector store of a strategy hold different chunks. The message carries the command that fixes it."""


def index_dir(name, base=None):
    return Path(base or INDEX_DIR) / name


def chroma_dir(name, base=None):
    return index_dir(name, base) / "chroma"


def chunks_path(name, base=None):
    return index_dir(name, base) / "chunks.json"


def manifest_path(name, base=None):
    return index_dir(name, base) / "manifest.json"


def index_version(name, base=None):
    """Changes when a finished index is written: the manifest is written last. None when there is no index."""
    for path in (manifest_path(name, base), chunks_path(name, base)):
        if path.is_file():
            return str(path.stat().st_mtime_ns)
    return None


def source_hash():
    """Version of the knowledge source the process is configured with."""
    from assistant.storage.factory import default_knowledge_source

    return default_knowledge_source().version()


def ingest_command(name):
    return f"python -m assistant.ingest {name}"


def write_manifest(strategy, chunk_count, base=None, source=None, embedding_model=None, embedding_dimensions=None):
    """Records which definition, knowledge source, and model the index was built with."""
    manifest = {
        "strategy": strategy.name,
        "definition_hash": strategy.definition_hash(),
        "source_hash": source or source_hash(),
        "embedding_model": embedding_model or OLLAMA_EMBEDDING_MODEL,
        "chunk_count": chunk_count,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    if embedding_dimensions is not None:
        manifest["embedding_dimensions"] = embedding_dimensions
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


def built_from(name, base=None):
    """The knowledge version the index was built from; None when there is no index."""
    manifest = read_manifest(name, base)
    return None if manifest is None else manifest.get("source_hash")


def index_changes(strategy, base=None, source=None, embedding_model=None, compare_source=True):
    """Returns (state, changed): changed names, in words, what differs between the index and the process.

    compare_source=False leaves the knowledge source out, for when it cannot be read.
    """
    manifest = read_manifest(strategy.name, base)
    if manifest is None or not chunks_path(strategy.name, base).is_file():
        return MISSING, []

    changed = []
    if manifest.get("definition_hash") != strategy.definition_hash():
        changed.append(DEFINITION_CHANGED)
    if compare_source and manifest.get("source_hash") != (source or source_hash()):
        changed.append(SOURCE_CHANGED)
    if manifest.get("embedding_model") != (embedding_model or OLLAMA_EMBEDDING_MODEL):
        changed.append(MODEL_CHANGED)
    return (STALE if changed else CURRENT), changed


def _reason(strategy, state, changed):
    command = ingest_command(strategy.name)
    if state == MISSING:
        return f"the index of strategy \"{strategy.name}\" has not been built yet; run: {command}"
    if state == STALE:
        return f"the index of strategy \"{strategy.name}\" is out of date ({' and '.join(changed)}); run: {command}"
    return None


def index_state(strategy, base=None, source=None, embedding_model=None, compare_source=True):
    """Returns (state, reason). The reason is None when the index is current."""
    state, changed = index_changes(strategy, base, source, embedding_model, compare_source)
    return state, _reason(strategy, state, changed)


def check_embedding_dimensions(strategy, embeddings, base=None):
    """Refuses an index built with another embedding size than the model returns now.

    Nothing is checked for an index built without the field, or while the embedding model does not answer:
    the server and the chat still start, and /health reports the model.
    """
    manifest = read_manifest(strategy.name, base)
    if manifest is None or manifest.get("embedding_dimensions") is None:
        return
    try:
        returned = len(embeddings.embed_query("dimension check"))
    except Exception:
        return
    built = manifest["embedding_dimensions"]
    if returned != built:
        raise IndexUnavailable(
            f'the embedding model returns {returned} dimensions but the index of strategy "{strategy.name}" '
            f"was built with {built}; run: {ingest_command(strategy.name)}"
        )


def require_index(strategy, base=None):
    """Raises IndexUnavailable if the index cannot be used."""
    state, reason = index_state(strategy, base)
    if state != CURRENT:
        raise IndexUnavailable(reason)


def require_index_for_http_source(strategy, knowledge, base=None):
    """Startup check of the server when the knowledge comes from the Node server.

    Returns the one warning line to print, or None when the index is current. A knowledge change that is not published
    yet, or a server that cannot be reached, leaves the last published index usable. A missing index, a changed strategy
    definition or a changed embedding model still refuse (IndexUnavailable). The file source keeps require_index.
    """
    try:
        version = knowledge.version()
    except KnowledgeUnavailable as error:
        unreachable = str(error)
        state, changed = index_changes(strategy, base, compare_source=False)
    else:
        unreachable = None
        state, changed = index_changes(strategy, base, source=version)
    if state == MISSING or DEFINITION_CHANGED in changed or MODEL_CHANGED in changed:
        raise IndexUnavailable(_reason(strategy, state, changed))
    if unreachable is not None:
        return f"{unreachable}; answering from the last published index"
    if SOURCE_CHANGED in changed:
        return "the knowledge has unpublished changes; answering from the last published index"
    return None
