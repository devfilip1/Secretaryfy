import re

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from assistant.config import IGNORED_LINE_PREFIXES, INTRO_SECTION_SUFFIX, ROOT, SOURCE_PDF, TEXT_FIXES
BULLET = "\x7f"  # this is how the PDF's list marker comes out of the extraction
# the running header of each page: "<document name> <marker> <page number>"
PAGE_HEADER = re.compile(rf"^\S.*\s{BULLET}\s+\d+$")
HEADING_STOPWORDS = {"a", "an", "the", "and", "or", "of", "to", "in", "for", "with", "without", "your", "before"}


def clean_text(text):
    """Fixes the extraction of one page.

    List markers become '- item', page headers and the paragraphs listed in IGNORED_LINE_PREFIXES are dropped,
    and the TEXT_FIXES are applied. Used by every strategy, so comparing them measures only the chunking.
    """
    for wrong, right in TEXT_FIXES.items():
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
        if line.startswith(IGNORED_LINE_PREFIXES):
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


def split_sections(text):
    """Splits an already clean text into sections: a list of (title, body lines)."""
    lines = text.splitlines()
    sections = []
    in_heading = False

    # A document that opens with its own name (one or two words, not a heading) has an opening block with no
    # heading: the name titles it, and the tagline right below the name is body, even though it looks like a heading.
    if lines and not is_heading(lines[0]) and len(lines[0].split()) <= 2 and ":" not in lines[0]:
        sections.append([f"{lines[0]} — {INTRO_SECTION_SUFFIX}", lines[1:2]])
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


def split_by_section(pages, parameters):
    """One chunk per section, so each value stays next to the name of the treatment it belongs to."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=parameters["max_chars"], chunk_overlap=parameters["overlap"], length_function=len
    )
    chunks = []
    # the pages are joined: a section may start on one page and end on the next
    for title, body in split_sections("\n".join(pages)):
        content = "\n".join([title, *body])
        # section larger than the limit: split the body and repeat the title in each part
        if len(content) <= parameters["max_chars"]:
            parts = [content]
        else:
            parts = [f"{title}\n{part}" for part in splitter.split_text("\n".join(body))]
        chunks.extend((part, {"section": title}) for part in parts)
    return chunks


def split_by_characters(pages, parameters):
    """Recursive character splitting of the whole text."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=parameters["chunk_size"], chunk_overlap=parameters["chunk_overlap"], length_function=len
    )
    return [(part, {}) for part in splitter.split_text("\n".join(pages))]


def split_by_page(pages, parameters):
    """One chunk per page."""
    return [(page, {"page": number}) for number, page in enumerate(pages, start=1) if page]


# To create a new kind of chunking: write the function and register it here (and in the schema under config/schemas).
STRATEGY_TYPES = {
    "section": split_by_section,
    "split": split_by_characters,
    "page": split_by_page,
}


def build_chunks(strategy, pages):
    """Chunks the brochure according to the strategy. pages is the text of each page, as it comes out of the PDF."""
    if strategy.type not in STRATEGY_TYPES:
        raise ValueError(f"unknown strategy type: {strategy.type}")

    source = SOURCE_PDF.relative_to(ROOT).as_posix()
    cleaned = [clean_text(page) for page in pages]
    return [
        Document(page_content=content, metadata={"source": source, "strategy": strategy.name, **extra})
        for content, extra in STRATEGY_TYPES[strategy.type](cleaned, strategy.parameters)
    ]


