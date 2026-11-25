"""Embedding comparison on the Portuguese retrieval questions: vector search only, no chat model.

Each question names the section that holds its answer. The chunks are the sections of the knowledge Markdown (the
`section` strategy), embedded with the environment's provider (or Ollama's --model NAME), and ranked by cosine similarity.
The numbers are comparable to the second-round table of evaluation/README.md (Portuguese, Stage 6c).

    python -m evaluation embeddings [--model NAME] [--json PATH] [--limit N]
    (python -m evaluation.embedding_compare with the same options still works)

The functions above the I/O section are pure: they take the vectors and the section names and return the numbers.
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np

QUESTIONS_PATH = Path(__file__).resolve().parent / "data" / "retrieval_questions_pt.json"
KNOWLEDGE_PATH = Path(__file__).resolve().parents[1] / "data" / "source" / "sorrisopleno.md"
# The `section` strategy of config/strategies.yaml, with the defaults of its type (max_chars 1200, overlap 100).
SECTION_STRATEGY = SimpleNamespace(name="section", type="section", parameters={"max_chars": 1200, "overlap": 100})
SECTION_SEPARATOR = " — "
TOP_K = 3


# --- pure functions -------------------------------------------------------------------------------------------------

def load_questions(data):
    """The questions file: {"sections": {key: title}, "questions": [{"q": text, "section": key or [keys]}]}.

    Returns one {"question", "expected"} per question, where "expected" lists the section titles that may hold the
    answer. A key missing from "sections" is taken as the title itself."""
    if not isinstance(data, dict) or not isinstance(data.get("sections"), dict) or not isinstance(data.get("questions"), list):
        raise ValueError('the questions file needs a "sections" object and a "questions" list')
    titles = data["sections"]
    items = []
    for number, entry in enumerate(data["questions"], start=1):
        if not isinstance(entry, dict) or not isinstance(entry.get("q"), str) or "section" not in entry:
            raise ValueError(f'question {number} needs a "q" text and a "section"')
        keys = entry["section"] if isinstance(entry["section"], list) else [entry["section"]]
        if not keys or not all(isinstance(key, str) for key in keys):
            raise ValueError(f'question {number}: "section" must be a key or a list of keys')
        items.append({"question": entry["q"], "expected": [titles.get(key, key) for key in keys]})
    return items


def section_matches(chunk_section, expected):
    """A chunk belongs to a section when its title is the section or starts with it ("Limpeza Dental — ...")."""
    return chunk_section == expected or chunk_section.startswith(expected + SECTION_SEPARATOR)


def cosine_scores(query, matrix):
    """Cosine similarity of one query vector with each row of the chunk matrix."""
    query = np.asarray(query, dtype=float)
    matrix = np.asarray(matrix, dtype=float)
    norms = np.linalg.norm(matrix, axis=1) * np.linalg.norm(query)
    return matrix @ query / np.where(norms == 0, 1.0, norms)


def rank_order(scores):
    """Chunk indexes from the most to the least similar (a stable sort, so ties keep the document order)."""
    return [int(index) for index in np.argsort(-np.asarray(scores, dtype=float), kind="stable")]


def evaluate(items, chunk_sections, orders):
    """Scores each question against the ranking of its chunks.

    items: from load_questions. chunk_sections: the section title of each chunk. orders: the rank_order of each question.
    Returns (rows, excluded): one row per scored question, and the questions whose section is not in the chunks."""
    rows, excluded = [], []
    for item, order in zip(items, orders):
        right = {index for index, section in enumerate(chunk_sections)
                 if any(section_matches(section, expected) for expected in item["expected"])}
        if not right:
            excluded.append({"question": item["question"], "expected": item["expected"]})
            continue
        rank = next(position for position, index in enumerate(order, start=1) if index in right)
        rows.append({
            "question": item["question"],
            "expected": item["expected"],
            "got": chunk_sections[order[0]],
            "rank": rank,
            "top1": rank == 1,
            "top3": rank <= TOP_K,
        })
    return rows, excluded


def mean_reciprocal_rank(rows):
    return sum(1 / row["rank"] for row in rows) / len(rows) if rows else 0.0


def percent(count, total):
    return 100 * count / total if total else 0.0


def summarize(rows):
    scored = len(rows)
    top1 = sum(row["top1"] for row in rows)
    top3 = sum(row["top3"] for row in rows)
    return {
        "scored": scored,
        "top1": {"count": top1, "percent": percent(top1, scored)},
        "top3": {"count": top3, "percent": percent(top3, scored)},
        "mrr": mean_reciprocal_rank(rows),
    }


def latency_summary(milliseconds):
    if not milliseconds:
        return {"median_ms": 0.0, "max_ms": 0.0}
    return {"median_ms": statistics.median(milliseconds), "max_ms": max(milliseconds)}


# --- I/O -----------------------------------------------------------------------------------------------------------

def load_chunks(knowledge_path):
    """The section chunks of the knowledge file, built by the ingestion's own code. Returns (texts, section titles)."""
    from assistant.ingestion.chunking import build_chunks
    from assistant.ingestion.markdown_source import MarkdownKnowledgeSource

    document = MarkdownKnowledgeSource(knowledge_path, name=knowledge_path.name).load()
    chunks = build_chunks(SECTION_STRATEGY, document)
    return [chunk.page_content for chunk in chunks], [chunk.metadata["section"] for chunk in chunks]


def build_provider(model=None):
    """The environment's provider, or Ollama's model NAME when --model is given."""
    if model is None:
        from assistant.storage.factory import default_embeddings

        return default_embeddings()
    from assistant.storage.embeddings import build_embeddings

    return build_embeddings(model=model)


def embed_all(provider, chunk_texts, questions):
    """Chunks in one embed_documents call; each question in its own embed_query call, timed in milliseconds."""
    chunk_vectors = provider.embed_documents(chunk_texts)
    query_vectors, milliseconds = [], []
    for question in questions:
        started = time.perf_counter()
        query_vectors.append(provider.embed_query(question))
        milliseconds.append((time.perf_counter() - started) * 1000)
    return chunk_vectors, query_vectors, milliseconds


def run(provider, items, chunk_texts, chunk_sections):
    chunk_vectors, query_vectors, milliseconds = embed_all(provider, chunk_texts, [item["question"] for item in items])
    orders = [rank_order(cosine_scores(query, chunk_vectors)) for query in query_vectors]
    rows, excluded = evaluate(items, chunk_sections, orders)
    return {
        "chunks": len(chunk_texts),
        "dimension": len(chunk_vectors[0]) if chunk_vectors else 0,
        "questions": len(items),
        **summarize(rows),
        "latency_ms": latency_summary(milliseconds),
        "misses": [row for row in rows if not row["top1"]],
        "excluded": excluded,
    }


def format_report(result, provider_name, model):
    top1, top3 = result["top1"], result["top3"]
    lines = [
        f"Embedding comparison, vector search only (provider {provider_name}, model {model or 'from the environment'})",
        f"Chunks: {result['chunks']}, embedding dimension: {result['dimension']}",
        f"Questions: {result['questions']}, scored: {result['scored']}, excluded (section not in the chunks): {len(result['excluded'])}",
        f"Right section first (top-1): {top1['count']} of {result['scored']} ({top1['percent']:.1f}%)",
        f"Right section in the top {TOP_K}: {top3['count']} of {result['scored']} ({top3['percent']:.1f}%)",
        f"MRR: {result['mrr']:.3f}",
        f"Query latency: median {result['latency_ms']['median_ms']:.1f} ms, max {result['latency_ms']['max_ms']:.1f} ms",
    ]
    if result["misses"]:
        lines.append("Misses (right section not first):")
        for miss in result["misses"]:
            lines.append(
                f'  - "{miss["question"]}" | expected: {" or ".join(miss["expected"])} | '
                f'got: {miss["got"]} | rank of the right section: {miss["rank"]}'
            )
    for item in result["excluded"]:
        lines.append(f'Excluded: "{item["question"]}" | section not in the chunks: {" or ".join(item["expected"])}')
    return "\n".join(lines)


def add_arguments(parser):
    parser.add_argument("--model", help="Ollama embedding model name; without it, the environment's provider is used")
    parser.add_argument("--json", type=Path, help="also save the numbers to this file")
    parser.add_argument("--limit", type=int, help="use only the first N questions (smoke run)")
    parser.add_argument("--questions", type=Path, default=QUESTIONS_PATH, help="questions file")
    parser.add_argument("--knowledge", type=Path, default=KNOWLEDGE_PATH, help="knowledge Markdown file")


def run_command(args):
    """Runs the comparison with the parsed arguments; returns the exit code."""
    if args.limit is not None and args.limit < 1:
        print("error: --limit must be at least 1", file=sys.stderr)
        return 2
    data = json.loads(args.questions.read_text(encoding="utf-8"))
    items = load_questions(data)
    if args.limit:
        items = items[: args.limit]
    chunk_texts, chunk_sections = load_chunks(args.knowledge)
    provider = build_provider(args.model)
    result = run(provider, items, chunk_texts, chunk_sections)
    result = {
        "provider": type(provider).__name__,
        "model": args.model,
        "questions_file": str(args.questions),
        "knowledge": str(args.knowledge),
        **result,
    }
    print(format_report(result, result["provider"], args.model))
    if args.json:
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Compare embedding models on the Portuguese retrieval questions.")
    add_arguments(parser)
    return run_command(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
