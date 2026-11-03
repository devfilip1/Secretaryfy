"""Knowledge written as a Markdown file: one "## Title" per subject, the lines below it are its body."""
import hashlib
from pathlib import Path

from assistant.ingestion.source import KnowledgeDocument, Section

HEADING = "## "


def parse_sections(text):
    """Sections of a Markdown text. Whatever comes before the first "## " (a "# Document title") is left out."""
    sections = []
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith(HEADING):
            sections.append((line[len(HEADING):].strip(), []))
        elif line and sections:
            sections[-1][1].append(line)
    return tuple(Section(title, tuple(body)) for title, body in sections)


class MarkdownKnowledgeSource:
    def __init__(self, path, *, name):
        self.path = Path(path)
        self.name = name

    def version(self):
        return hashlib.sha256(self.path.read_bytes()).hexdigest()[:16]

    def load(self):
        text = self.path.read_text(encoding="utf-8")
        sections = parse_sections(text)
        # no pages in a Markdown file: the page and split strategies see the whole text as one page
        whole = "\n".join("\n".join([section.title, *section.body]) for section in sections)
        return KnowledgeDocument(self.name, self.version(), (whole,), sections)
