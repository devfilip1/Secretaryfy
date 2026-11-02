import re

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

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


def split_by_section(document, parameters):
    """One chunk per section, so each value stays next to the name of the treatment it belongs to."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=parameters["max_chars"], chunk_overlap=parameters["overlap"], length_function=len
    )
    chunks = []
    # the pages are joined: a section may start on one page and end on the next
    for title, body in split_sections("\n".join(document.pages), document.intro_suffix):
        content = "\n".join([title, *body])
        # section larger than the limit: split the body and repeat the title in each part
        if len(content) <= parameters["max_chars"]:
            parts = [content]
        else:
            parts = [f"{title}\n{part}" for part in splitter.split_text("\n".join(body))]
        chunks.extend((part, {"section": title}) for part in parts)
    return chunks


def split_by_characters(document, parameters):
    """Recursive character splitting of the whole text."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=parameters["chunk_size"], chunk_overlap=parameters["chunk_overlap"], length_function=len
    )
    return [(part, {}) for part in splitter.split_text("\n".join(document.pages))]


def split_by_page(document, parameters):
    """One chunk per page."""
    return [(page, {"page": number}) for number, page in enumerate(document.pages, start=1) if page]


# To create a new kind of chunking: write the function and register it here (and in the schema under config/schemas).
STRATEGY_TYPES = {
    "section": split_by_section,
    "split": split_by_characters,
    "page": split_by_page,
}


def build_chunks(strategy, document):
    """Chunks a knowledge document according to the strategy."""
    if strategy.type not in STRATEGY_TYPES:
        raise ValueError(f"unknown strategy type: {strategy.type}")

    return [
        Document(page_content=content, metadata={"source": document.name, "strategy": strategy.name, **extra})
        for content, extra in STRATEGY_TYPES[strategy.type](document, strategy.parameters)
    ]


