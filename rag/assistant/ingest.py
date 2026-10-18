import json
import re
import sys

from langchain_chroma.vectorstores import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_ollama import OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from assistant.config import (
    COLLECTION_NAME,
    IGNORED_LINE_PREFIXES,
    INTRO_SECTION_SUFFIX,
    OLLAMA_BASE_URL,
    OLLAMA_EMBEDDING_MODEL,
    ROOT,
    SOURCE_PDF,
    TEXT_FIXES,
)
from assistant.index import chroma_dir, chunks_path, index_dir, write_manifest
from assistant.settings import SettingsError, load_settings

BULLET = "\x7f"  # this is how the PDF's list marker comes out of the extraction
# the running header of each page: "<document name> <marker> <page number>"
PAGE_HEADER = re.compile(rf"^\S.*\s{BULLET}\s+\d+$")
HEADING_STOPWORDS = {"a", "an", "the", "and", "or", "of", "to", "in", "for", "with", "without", "your", "before"}


class PrefixedEmbeddings(Embeddings):
    """nomic-embed-text was trained with a prefix that says whether the text is a document or a query."""

    def __init__(self, model, base_url):
        self._inner = OllamaEmbeddings(model=model, base_url=base_url)
        self._prefixed = model.startswith("nomic-embed-text")

    def embed_documents(self, texts):
        if self._prefixed:
            texts = [f"search_document: {text}" for text in texts]
        return self._inner.embed_documents(texts)

    def embed_query(self, text):
        if self._prefixed:
            text = f"search_query: {text}"
        return self._inner.embed_query(text)


EMBEDDINGS = PrefixedEmbeddings(OLLAMA_EMBEDDING_MODEL, OLLAMA_BASE_URL)


def load_pages():
    """Text of each page of the brochure, as it comes out of the PDF."""
    return [page.extract_text() for page in PdfReader(SOURCE_PDF).pages]


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


def save_chunks(strategy, chunks):
    data = []

    for chunk in chunks:
        data.append({
            "content": chunk.page_content,
            "metadata": chunk.metadata
        })

    index_dir(strategy.name).mkdir(parents=True, exist_ok=True)
    with open(chunks_path(strategy.name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def vectorize_chunks(strategy, chunks):
    directory = str(chroma_dir(strategy.name))
    # deletes the old collection so the chunks are not duplicated on every run
    Chroma(collection_name=COLLECTION_NAME, persist_directory=directory, embedding_function=EMBEDDINGS).delete_collection()
    Chroma.from_documents(chunks, EMBEDDINGS, collection_name=COLLECTION_NAME, persist_directory=directory)


def build_index(strategy, pages=None):
    """Creates or recreates the index of one strategy, without touching the indexes of the others."""
    chunks = build_chunks(strategy, pages if pages is not None else load_pages())
    save_chunks(strategy, chunks)
    vectorize_chunks(strategy, chunks)
    write_manifest(strategy, len(chunks))
    return len(chunks)


def main(argv=None):
    """python -m assistant.ingest [STRATEGY...] — with no arguments, builds the indexes of all of them."""
    names = list(sys.argv[1:] if argv is None else argv)
    try:
        declared = load_settings().strategies
    except SettingsError as error:
        print(f"Invalid configuration: {len(error.problems)} problem(s)")
        for problem in error.problems:
            print(f"  - {problem}")
        return 2

    unknown = [name for name in names if name not in declared]
    if unknown:
        print(f"Unknown strategy: {', '.join(unknown)}. Use one of: {', '.join(declared)}")
        return 2

    pages = load_pages()
    for name in names or declared:
        count = build_index(declared[name], pages)
        print(f"{name}: {count} chunks in data/index/{name}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
