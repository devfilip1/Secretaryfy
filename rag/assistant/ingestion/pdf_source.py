"""The clinic brochure as a knowledge source: reads the PDF and renders it into the normalized document."""
import hashlib
import re
from pathlib import Path

from assistant.ingestion.source import KnowledgeDocument, Section

BULLET = "\x7f"  # this is how the PDF's list marker comes out of the extraction
# the running header of each page: "<document name> <marker> <page number>"
PAGE_HEADER = re.compile(rf"^\S.*\s{BULLET}\s+\d+$")
HEADING_STOPWORDS = {"a", "an", "the", "and", "or", "of", "to", "in", "for", "with", "without", "your", "before"}


def is_heading(line):
    """Section title: a short line with no colon and no digits, with almost every word capitalized."""
    if line.startswith("- ") or ":" in line or line.endswith(".") or len(line) > 90:
        return False
    if any(char.isdigit() for char in line):  # addresses and phone numbers also have capitalized words
        return False
    words = [word for word in re.findall(r"[^\W\d_]+", line) if word.lower() not in HEADING_STOPWORDS]
    if len(words) < 2:
        return False
    return sum(word[0].isupper() for word in words) / len(words) >= 0.75


def split_sections(text, intro_suffix):
    """Splits an already clean text into sections: a list of (title, body lines)."""
    lines = text.splitlines()
    sections = []
    in_heading = False

    # A document that opens with its own name (one or two words, not a heading) has an opening block with no
    # heading: the name titles it, and the tagline right below the name is body, even though it looks like a heading.
    if lines and not is_heading(lines[0]) and len(lines[0].split()) <= 2 and ":" not in lines[0]:
        sections.append([f"{lines[0]} — {intro_suffix}", lines[1:2]])
        lines = lines[2:]

    for line in lines:
        # a long title wraps into two lines; the second one may be a single word.
        # Field labels in capitals ("LOCATION") and lines with digits are never part of a title.
        continuation = (
            in_heading and not line.startswith("- ") and ":" not in line and line[0].isupper()
            and len(line.split()) <= 6 and not line.isupper() and not any(char.isdigit() for char in line)
        )
        if in_heading and (is_heading(line) or continuation) and not sections[-1][1]:
            sections[-1][0] += f" {line}"
        elif is_heading(line):
            sections.append([line, []])
            in_heading = True
        elif sections:
            sections[-1][1].append(line)
            in_heading = False
    return [(title, body) for title, body in sections]


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
        # the pages are joined: a section may start on one page and end on the next
        sections = tuple(Section(title, tuple(body)) for title, body in split_sections("\n".join(pages), self.intro_suffix))
        return KnowledgeDocument(self.name, self.version(), pages, sections)
