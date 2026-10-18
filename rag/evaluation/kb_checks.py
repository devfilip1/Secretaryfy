"""Checks of the knowledge base, with no language model."""
import json
import unicodedata
from collections import Counter

from evaluation.normalize import normalize_text
from evaluation.retrieval_metrics import contains

# Characters that show a failure in extracting the PDF text.
CORRUPTED_CHARS = {"■", "□", "�"}
ALLOWED_CONTROL = {"\n", "\r", "\t"}


def load_kb(strategy_name):
    """Returns (chunks of the vector base, chunks of the file used by the word-based search) of a strategy."""
    from langchain_chroma.vectorstores import Chroma

    from assistant.config import COLLECTION_NAME
    from assistant.index import chroma_dir, chunks_path
    from assistant.ingest import EMBEDDINGS

    db = Chroma(collection_name=COLLECTION_NAME, persist_directory=str(chroma_dir(strategy_name)),
                embedding_function=EMBEDDINGS)
    vector_chunks = db._collection.get(include=["documents"])["documents"]
    with open(chunks_path(strategy_name), "r", encoding="utf-8") as f:
        file_chunks = [chunk["content"] for chunk in json.load(f)]
    return vector_chunks, file_chunks


def find_duplicates(chunks):
    """Chunks stored more than once, with the number of repetitions."""
    counts = Counter(normalize_text(chunk) for chunk in chunks)
    first = {}
    for chunk in chunks:
        first.setdefault(normalize_text(chunk), chunk)
    return [{"content": first[key], "count": count} for key, count in counts.items() if count > 1]


def find_unanchored_facts(answer_key, chunks):
    """Evidence quotes of the answer key that have no chunk with the name of the procedure next to them.

    kind "missing": no chunk contains the whole evidence (for example, the chunking cut the line).
    kind "unanchored": there are chunks with the evidence, but none of them has the name of the procedure.
    """
    problems = []
    seen = set()
    for item in answer_key.items:
        anchors = answer_key.anchors(item.procedure)
        for evidence in item.evidence:
            if (item.procedure, evidence) in seen:
                continue
            seen.add((item.procedure, evidence))
            holders = [chunk for chunk in chunks if contains(chunk, evidence)]
            if not holders:
                kind = "missing"
            elif anchors and not any(contains(chunk, anchor) for chunk in holders for anchor in anchors):
                kind = "unanchored"
            else:
                continue
            problems.append({"kind": kind, "item_id": item.id, "procedure": item.procedure, "evidence": evidence})
    return problems


def find_corrupted(chunks):
    """Chunks with characters corrupted in the extraction."""
    problems = []
    for chunk in chunks:
        bad = sorted({
            char for char in chunk
            if char in CORRUPTED_CHARS or (unicodedata.category(char) == "Cc" and char not in ALLOWED_CONTROL)
        })
        if bad:
            problems.append({"content": chunk, "chars": [f"U+{ord(char):04X}" for char in bad]})
    return problems


def find_source_mismatch(vector_chunks, file_chunks):
    """Differences between the vector base and the chunk file, which should have the same content."""
    vector = Counter(normalize_text(chunk) for chunk in vector_chunks)
    lexical = Counter(normalize_text(chunk) for chunk in file_chunks)
    return {
        "vector_count": len(vector_chunks),
        "file_count": len(file_chunks),
        "only_in_vector": sum((vector - lexical).values()),
        "only_in_file": sum((lexical - vector).values()),
        "mismatch": vector != lexical,
    }


def run_checks(answer_key, vector_chunks, file_chunks):
    return {
        "chunk_count": len(vector_chunks),
        "duplicates": find_duplicates(vector_chunks),
        "unanchored": find_unanchored_facts(answer_key, vector_chunks),
        "corrupted": find_corrupted(vector_chunks),
        "source_mismatch": find_source_mismatch(vector_chunks, file_chunks),
    }
