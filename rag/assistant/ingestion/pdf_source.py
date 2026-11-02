"""The clinic brochure as a knowledge source: reads the PDF and renders it into the normalized document."""
import hashlib
import re
from pathlib import Path

from assistant.ingestion.chunking import is_heading
from assistant.ingestion.source import KnowledgeDocument

BULLET = "\x7f"  # this is how the PDF's list marker comes out of the extraction
# the running header of each page: "<document name> <marker> <page number>"
PAGE_HEADER = re.compile(rf"^\S.*\s{BULLET}\s+\d+$")


def clean_text(text, text_fixes, ignored_line_prefixes):
    """Fixes the extraction of one page.

    List markers become '- item', page headers and the paragraphs starting with one of ignored_line_prefixes are
    dropped, and text_fixes ({wrong: right}) are applied. Used by every strategy, so comparing them measures only the chunking.
    """
    for wrong, right in text_fixes.items():
        text = text.replace(wrong, right)

    lines = []
    pending_bullet = False
    ignoring = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or PAGE_HEADER.match(line):
            continue
        if line == BULLET:  # marker alone: the item is the next line
            pending_bullet = True
            ignoring = False
            continue
        if line.startswith(BULLET):  # marker and item on the same line
            lines.append(f"- {line[len(BULLET):].strip()}")
            pending_bullet = ignoring = False
            continue
        if line.startswith(ignored_line_prefixes):
            ignoring = True
            continue
        if ignoring:
            # the ignored paragraph goes on until something that is clearly not its continuation
            if not pending_bullet and ":" not in line and not is_heading(line):
                continue
            ignoring = False
        lines.append(f"- {line}" if pending_bullet else line)
        pending_bullet = False
    return "\n".join(lines)


class PdfBrochureSource:
    def __init__(self, path, *, name, text_fixes, ignored_line_prefixes, intro_suffix):
        self.path = Path(path)
        self.name = name
        self.text_fixes = text_fixes
        self.ignored_line_prefixes = tuple(ignored_line_prefixes)
        self.intro_suffix = intro_suffix

    def version(self):
        return hashlib.sha256(self.path.read_bytes()).hexdigest()[:16]

    def load(self):
        from pypdf import PdfReader

        pages = tuple(
            clean_text(page.extract_text(), self.text_fixes, self.ignored_line_prefixes)
            for page in PdfReader(self.path).pages
        )
        return KnowledgeDocument(self.name, self.version(), pages, self.intro_suffix)
