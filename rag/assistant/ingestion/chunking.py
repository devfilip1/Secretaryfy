from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter


def split_by_section(document, parameters):
    """One chunk per section, so each value stays next to the name of the treatment it belongs to."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=parameters["max_chars"], chunk_overlap=parameters["overlap"], length_function=len
    )
    chunks = []
    for section in document.sections:
        title, body = section.title, section.body
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


