"""The knowledge the assistant answers from, in one format whatever it was written in.

A source (the PDF brochure today; Markdown or the panel later) renders its content into a KnowledgeDocument. Chunking and
indexing only know the document, never the format it came from.
"""
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Section:
    """One subject of the document: a treatment, or the clinic itself (address, hours, contact)."""

    title: str
    body: tuple[str, ...]  # the lines under the title; a list item starts with "- "


@dataclass(frozen=True)
class KnowledgeDocument:
    name: str  # how the source is shown in each chunk's metadata
    version: str  # changes when the content changes; recorded in the manifest of every index built from it
    pages: tuple[str, ...]  # clean text, one entry per page, in reading order; a source without pages has one
    sections: tuple[Section, ...]  # the same content split by subject; the source decides where each one starts


class KnowledgeSource(Protocol):
    def version(self) -> str:
        """Cheap to call: the index checks it on every start. Equals load().version."""
        ...

    def load(self) -> KnowledgeDocument: ...
