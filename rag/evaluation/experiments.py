"""Bench of search experiments: runs each experiment over the answer key, without generating answers, and compares.

It measures the search only. The final answer is still evaluated by `python -m evaluation run`.
"""
import csv
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from evaluation.retrieval_metrics import SOURCES, score_all_sources

PACKAGE_DIR = Path(__file__).parent
RESULTS_DIR = PACKAGE_DIR / "runs" / "experiments"

OK, NOT_RUN, INCOMPLETE = "ok", "not_run", "incomplete"

SUMMARY_COLUMNS = (
    "experiment", "search_type", "collection", "match_threshold", "match_count", "use_hyde", "score", "hits",
    "total", "true_rate", "anchored_rate", "avg_latency_ms", "status", "reason", "answer_key_version", "embedding_model",
)
QUESTION_COLUMNS = (
    "experiment", "item_id", "question", "hit", "score", "anchored", "retrieved_count", "latency_ms",
)


@dataclass
class QuestionResult:
    experiment: str
    item_id: str
    question: str
    hit: bool            # every evidence of the item came among the chunks
    score: float         # mean similarity of the returned chunks; 0 if none
    anchored: bool       # the chunk with the evidence has the name of the procedure
    retrieved_count: int
    latency_ms: float
    has_procedure: bool = True
    sources: dict = field(default_factory=dict)      # metrics per source (vector, bm25, fused)
    retrieved: list = field(default_factory=list)    # first line of each chunk sent to the model


@dataclass
class ExperimentResult:
    experiment: object   # assistant.settings.Experiment
    status: str = OK
    reason: str = ""
    questions: list = field(default_factory=list)

    @property
    def total(self):
        return len(self.questions)

    @property
    def hits(self):
        return sum(question.hit for question in self.questions)

    @property
    def true_rate(self):
        return self.hits / self.total if self.total else None

    @property
    def score(self):
        return sum(question.score for question in self.questions) / self.total if self.total else None

    @property
    def anchored_rate(self):
        with_procedure = [question.anchored for question in self.questions if question.has_procedure]
        return sum(with_procedure) / len(with_procedure) if with_procedure else None

    @property
    def avg_latency_ms(self):
        return sum(question.latency_ms for question in self.questions) / self.total if self.total else None


def select_items(answer_key):
    """Answerable questions of the working set. The reserved part never enters the bench."""
    return [item for item in answer_key.items if item.answerable and item.split == "dev"]


def default_index_check(experiment):
    """Reason why the experiment cannot run, or None."""
    from assistant.index import CURRENT, index_state
    from assistant.settings import get_strategy

    state, reason = index_state(get_strategy(experiment.collection))
    return None if state == CURRENT else reason


def default_retrieve(question, experiment):
    from assistant.pipeline import RagConfig, retrieve

    return retrieve(question, RagConfig.from_experiment(experiment))


def evaluate_question(experiment, item, retrieval, answer_key, latency_ms):
    retrieved = {source: [asdict(chunk) for chunk in getattr(retrieval, source)] for source in SOURCES}
    sources = score_all_sources(item, retrieved, answer_key)
    fused = retrieved["fused"]
    similarities = [chunk.get("similarity") or 0.0 for chunk in fused]
    return QuestionResult(
        experiment=experiment.exp_name,
        item_id=item.id,
        question=item.question,
        hit=sources["fused"]["recall"] == 1,
        score=sum(similarities) / len(similarities) if similarities else 0.0,
        anchored=sources["fused"]["anchored"],
        retrieved_count=len(fused),
        latency_ms=latency_ms,
        has_procedure=bool(item.procedure),
        sources=sources,
        retrieved=[chunk["content"].splitlines()[0] for chunk in fused],
    )


def run_experiment(experiment, items, answer_key, retrieve_fn=None, index_check=None, on_progress=None, on_question=None):
    """Runs one experiment. It never raises because of an experiment: it returns the status and the reason."""
    retrieve_fn = retrieve_fn or default_retrieve
    reason = (index_check or default_index_check)(experiment)
    if reason:
        return ExperimentResult(experiment, NOT_RUN, reason)

    try:
        retrieve_fn("Hello", experiment)  # warm-up: loads models and index, outside the measurement
    except Exception as error:
        return ExperimentResult(experiment, NOT_RUN, f"the search could not be started ({type(error).__name__}: {error})")

    result = ExperimentResult(experiment)
    for item in items:
        try:
            start = time.perf_counter()
            retrieval = retrieve_fn(item.question, experiment)
            latency_ms = (time.perf_counter() - start) * 1000
        except (Exception, KeyboardInterrupt) as error:
            result.status = INCOMPLETE
            detail = f": {error}" if str(error) else ""
            result.reason = (
                f"interrupted after {result.total} of {len(items)} questions ({type(error).__name__}{detail})"
            )
            break
        question = evaluate_question(experiment, item, retrieval, answer_key, latency_ms)
        result.questions.append(question)
        if on_question:
            on_question(question)
        if on_progress:
            on_progress()
    return result


def run_all(experiments, items, answer_key, **options):
    return [run_experiment(experiment, items, answer_key, **options) for experiment in experiments]


def sort_results(results):
    """From best to worst: True Rate, then Score, then name. The ones not run stay at the end.

    On a True Rate tie, experiments with HyDE come after the ones without: their Score is measured against the
    hypothetical answer and comes out higher, so it cannot break a tie against an experiment without HyDE.
    """
    done = [result for result in results if result.status == OK]
    others = [result for result in results if result.status != OK]
    done.sort(key=lambda result: (
        -(result.true_rate or 0), result.experiment.use_hyde, -(result.score or 0), result.experiment.exp_name))
    return done + others


def format_question_line(question):
    """Detail line: question;hit;score."""
    return f"{question.question};{'true' if question.hit else 'false'};{question.score:.2f}"


def source_summary(result):
    """Means per search source (vector, word-based, and combined), for the retrieval command."""
    summary = {}
    for source in SOURCES:
        scores = [question.sources[source] for question in result.questions]
        summary[source] = {
            name: sum(score[name] for score in scores) / len(scores) if scores else 0.0
            for name in ("hit", "recall", "mrr", "context_precision", "anchored")
        }
    return summary


def misses(result):
    """Questions in which some evidence did not reach the model."""
    return [
        {"item_id": question.item_id, "question": question.question, "retrieved": question.retrieved}
        for question in result.questions if not question.hit
    ]


def _number(value, digits):
    return "" if value is None else f"{value:.{digits}f}"


def _boolean(value):
    return "true" if value else "false"


def summary_row(result, answer_key_version, embedding_model):
    experiment = result.experiment
    done = result.status == OK
    return {
        "experiment": experiment.exp_name,
        "search_type": experiment.search_type,
        "collection": experiment.collection,
        "match_threshold": f"{experiment.match_threshold:.2f}",
        "match_count": experiment.match_count,
        "use_hyde": _boolean(experiment.use_hyde),
        "score": _number(result.score, 4) if done else "",
        "hits": result.hits if done else "",
        "total": result.total if done else "",
        "true_rate": _number(result.true_rate, 4) if done else "",
        "anchored_rate": _number(result.anchored_rate, 4) if done else "",
        "avg_latency_ms": _number(result.avg_latency_ms, 1) if done else "",
        "status": result.status,
        "reason": result.reason,
        "answer_key_version": answer_key_version,
        "embedding_model": embedding_model,
    }


def write_csv(results, started_at, answer_key_version, embedding_model, directory=RESULTS_DIR):
    """Writes the summary and the per-question detail. Returns the two paths."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    stamp = started_at.strftime("%Y%m%d-%H%M%S")
    attempt = 1
    while (directory / f"{stamp}-summary.csv").exists():  # two runs in the same second do not overwrite each other
        attempt += 1
        stamp = f"{started_at.strftime('%Y%m%d-%H%M%S')}-{attempt}"
    summary_path = directory / f"{stamp}-summary.csv"
    questions_path = directory / f"{stamp}-questions.csv"

    # UTF-8 with BOM so Excel opens it directly with the right encoding
    with open(summary_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SUMMARY_COLUMNS, delimiter=",")
        writer.writeheader()
        for result in results:
            writer.writerow(summary_row(result, answer_key_version, embedding_model))

    with open(questions_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=QUESTION_COLUMNS, delimiter=",")
        writer.writeheader()
        for result in results:
            for question in result.questions:
                writer.writerow({
                    "experiment": question.experiment,
                    "item_id": question.item_id,
                    "question": question.question,
                    "hit": _boolean(question.hit),
                    "score": f"{question.score:.4f}",
                    "anchored": _boolean(question.anchored),
                    "retrieved_count": question.retrieved_count,
                    "latency_ms": f"{question.latency_ms:.1f}",
                })
    return summary_path, questions_path
