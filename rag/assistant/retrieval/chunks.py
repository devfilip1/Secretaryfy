"""Where the lexical search reads the chunks of each strategy, and a version that changes when they change."""
import json
from typing import Protocol

from assistant.index import IndexUnavailable, chunks_path, index_version, ingest_command


class ChunkSource(Protocol):
    """The texts of the chunks of a strategy, and the version of that set of texts."""

    def version(self, strategy: str) -> str | None: ...

    def chunks(self, strategy: str) -> list[str]: ...


class JsonChunkSource:
    """Reads the chunks.json that the ingestion writes for each strategy."""

    def __init__(self, base=None):
        self._base = base

    def version(self, strategy: str) -> str | None:
        return index_version(strategy, self._base)

    def chunks(self, strategy: str) -> list[str]:
        path = chunks_path(strategy, self._base)
        if not path.is_file():
            raise IndexUnavailable(
                f'the index of strategy "{strategy}" has not been built yet; run: {ingest_command(strategy)}'
            )
        with open(path, "r", encoding="utf-8") as f:
            return [item["content"] for item in json.load(f)]
