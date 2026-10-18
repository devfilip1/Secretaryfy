"""Scoreboard on the terminal and in report.md."""
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from evaluation.judge import CRITERIA
from evaluation.normalize import format_money, format_time

SUBSET_LABELS = {"dev": "full (dev)", "holdout": "reserved part (holdout)", "smoke": "quick (smoke)"}
SOURCE_LABELS = {"vector": "Vector", "bm25": "Lexical (BM25)", "fused": "Combined (sent to the model)"}
CAUSE_LABELS = {
    "retrieval_failure": "Search failure",
    "answer_failure": "Answer failure",
    "fabricated": "Made-up information",
    "wrong_refusal": "Wrong refusal",
    "rule_violation": "Service rule violation",
}
CATEGORY_LABELS = {
    "price": "Price", "duration": "Duration", "result": "Result", "indication": "Indication",
    "how_it_works": "How it works", "differentials": "Differentials", "comparison": "Comparison",
    "clinic_info": "Clinic information", "out_of_scope": "Out of scope", "adversarial": "Attempt to break the role",
}
FLAG_LABELS = {
    "evidence_not_anchored": "evidence retrieved without the name of the procedure",
    "other_procedure_value": "value from another procedure",
}
VIOLATION_LABELS = {"too_long": "answer too long", "not_english": "answer not in English"}
UNIT_LABELS = {
    "minute": "min", "hour": "h", "day": "days", "month": "months", "year": "years",
    "session": "sessions", "visit": "appointments",
}
METRIC_LABELS = {
    "overall.pass_rate": "Overall score",
    "answer.factual_accuracy": "Factual accuracy",
    "answer.faithfulness_numeric": "Numeric faithfulness",
    "answer.correct_refusal_rate": "Correct refusal",
    "answer.wrong_refusal_rate": "Wrong refusal",
    "answer.rule_compliance": "Service rules",
    "operational.latency_p50": "Typical time (p50)",
    "operational.latency_p95": "Time of the slowest (p95)",
}
RETRIEVAL_LABELS = {
    "hit_rate": "Hit", "recall": "Recall", "mrr": "MRR",
    "context_precision": "Context precision", "anchored_rate": "Anchored evidence",
}
ANSWER_NOTES = {
    "factual_accuracy": "answerable questions: every fact right and no stray value",
    "faithfulness_numeric": "answers with no value that is not in the retrieved chunks",
    "correct_refusal_rate": "questions with no answer in the brochure that it refused",
    "wrong_refusal_rate": "answerable questions that it refused (lower is better)",
    "rule_compliance": "answers that break no service rule",
}
LOWER_IS_BETTER = {"answer.wrong_refusal_rate", "operational.latency_p50", "operational.latency_p95"}


def metric_label(name):
    if name in METRIC_LABELS:
        return METRIC_LABELS[name]
    group, _, rest = name.partition(".")
    if group == "retrieval":
        source, _, metric = rest.partition(".")
        return f"{SOURCE_LABELS[source].split(' ')[0]} search: {RETRIEVAL_LABELS[metric].lower()}"
    if group == "judge":
        return f"Judge: {CRITERIA.get(rest, {}).get('label', rest).lower()}"
    return name


def pct(value):
    return "—" if value is None else f"{value * 100:.1f}%"


def _value(name, value):
    if value is None:
        return "—"
    if name.startswith("operational."):
        return f"{value:.1f} s"
    if name.endswith(".mrr"):
        return f"{value:.2f}"
    return pct(value)


def _delta(name, delta):
    if delta is None:
        return "—"
    if name.startswith("operational."):
        return f"{delta:+.1f} s"
    if name.endswith(".mrr"):
        return f"{delta:+.2f}"
    return f"{delta * 100:+.1f} pp"


def describe_fact(fact):
    if fact.type == "money":
        return f"{fact.label}: " + " to ".join(format_money(value) for value in fact.values)
    if fact.type == "duration":
        return f"{fact.label}: " + " to ".join(f"{value:g}" for value in fact.values) + f" {UNIT_LABELS[fact.unit]}"
    if fact.type == "time":
        return f"{fact.label}: " + " to ".join(format_time(value) for value in fact.values)
    return f"{fact.label}: \"{fact.alternatives[0]}\""


def describe_expected(item):
    if not item.answerable:
        return "say it does not have the information"
    return "; ".join(describe_fact(fact) for fact in item.expected_facts)


def describe_problem(result):
    parts = []
    missing = [fact["label"] for fact in result["facts"] if not fact["found"]]
    if missing:
        parts.append("missing: " + ", ".join(missing))
    if result["unexpected_values"]:
        parts.append("unexpected value: " + ", ".join(result["unexpected_values"]))
    if result["ungrounded_values"]:
        parts.append("not in the chunks: " + ", ".join(result["ungrounded_values"]))
    for violation in result["rule_violations"]:
        kind, _, term = violation.partition(":")
        parts.append(f"mentioned \"{term}\"" if kind == "forbidden_term" else VIOLATION_LABELS.get(violation, violation))
    parts.extend(FLAG_LABELS.get(flag, flag) for flag in result["flags"])
    return "; ".join(parts)


def _short(text, limit=160):
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _describe_assistant(config):
    """Scoreboard line that says which configuration the evaluation ran with."""
    extras = ""
    if config.get("match_threshold"):
        extras += f", threshold {config['match_threshold']:.2f}"
    if config.get("use_hyde"):
        extras += ", HyDE"
    if config.get("prompt") == "original":
        extras += ", original prompt"
    return (f"{config['chat_model']}, experiment {config['experiment']} (strategy {config['strategy']}, "
            f"{config['kb_chunk_count']} chunks, {config['search_type']} search, "
            f"up to {config['match_count']} chunks{extras})")


def sections(run, answer_key):
    """Sections of the scoreboard as (title, columns, rows), used by the terminal and by report.md."""
    metrics = run["metrics"]
    items = answer_key.by_id()
    out = []

    config = run["config"]
    out.append(("Summary", ["", ""], [
        ["Overall score", f"{pct(metrics['overall']['pass_rate'])} of {metrics['overall']['item_count']} questions"],
        ["Subset", SUBSET_LABELS[run["subset"]]],
        ["Answer key", run["answer_key_version"]],
        ["Assistant", _describe_assistant(config)],
        ["Answer time", f"typical {metrics['operational']['latency_p50']:.1f} s, "
                        f"slowest {metrics['operational']['latency_p95']:.1f} s"],
    ]))

    out.append(("Answer (deterministic)", ["Metric", "Score", "What it measures"], [
        [METRIC_LABELS[f"answer.{name}"], pct(metrics["answer"][name]), note] for name, note in ANSWER_NOTES.items()
    ]))

    out.append(("Search (questions answered by the brochure)", ["Source", *RETRIEVAL_LABELS.values()], [
        [SOURCE_LABELS[source], *(_value(f"retrieval.{source}.{name}", metrics["retrieval"][source][name])
                                  for name in RETRIEVAL_LABELS)]
        for source in SOURCE_LABELS
    ]))

    if metrics.get("judge"):
        rows = []
        for criterion, entry in metrics["judge"].items():
            agreement = entry.get("human_agreement")
            status = "not checked" if agreement is None else ("yes" if agreement >= 0.8 else "NOT RELIABLE")
            rows.append([CRITERIA[criterion]["label"], pct(entry["score"]), pct(agreement), status])
        out.append((f"Behaviour (judge: {config['judge_model']}; not part of the overall score)",
                    ["Criterion", "Score", "Agreement with the person", "Reliable?"], rows))

    causes = metrics["diagnosis"]["by_cause"]
    if any(causes.values()):
        out.append(("Cause of the errors", ["Cause", "Questions"], [
            [CAUSE_LABELS[cause], str(count)] for cause, count in causes.items() if count
        ]))

    out.append(("By question type", ["Type", "Score"], [
        [CATEGORY_LABELS[name], pct(value)] for name, value in metrics["diagnosis"]["by_category"].items()
    ]))
    if metrics["diagnosis"]["by_procedure"]:
        out.append(("By procedure", ["Procedure", "Score"], [
            [name, pct(value)] for name, value in metrics["diagnosis"]["by_procedure"].items()
        ]))

    if run.get("variance"):
        rows = [
            [metric_label(name), _value(name, entry["mean"]), _value(name, entry["min"]), _value(name, entry["max"]),
             _delta(name, entry["max"] - entry["min"]).lstrip("+")]
            for name, entry in run["variance"].items() if not name.startswith(("retrieval.vector", "retrieval.bm25"))
        ]
        out.append((f"Variation across {run['repeat']} repetitions", ["Metric", "Mean", "Minimum", "Maximum", "Range"], rows))

    wrong = [result for result in run["results"] if not result["passed"]]
    if wrong:
        out.append((f"Wrong questions ({len(wrong)})", ["Item", "Question", "Answer", "Expected", "Cause", "Detail"], [
            [result["item_id"], items[result["item_id"]].question, _short(result["answer"]),
             describe_expected(items[result["item_id"]]), CAUSE_LABELS.get(result["cause"], "—"),
             describe_problem(result)]
            for result in wrong
        ]))
    return out


def _print_wrong_items(console, title, rows):
    """Wrong questions are printed as blocks: in a table the columns get too narrow."""
    console.print(f"[bold]{title}[/bold]\n")
    for item_id, question, answer, expected, cause, detail in rows:
        console.print(f"[red]✗[/red] [bold]{item_id}[/bold]  ({cause})")
        console.print(f"    Question: {escape(question)}")
        console.print(f"    Answer:   {escape(answer)}")
        console.print(f"    Expected: {escape(expected)}")
        if detail:
            console.print(f"    Detail:   {escape(detail)}")
        console.print()


def _print_sections(console, parts):
    for title, columns, rows in parts:
        if columns[0] == "Item":
            _print_wrong_items(console, title, rows)
            continue
        table = Table(title=title, title_justify="left", show_header=any(columns), header_style="bold")
        for column in columns:
            table.add_column(column, overflow="fold")
        for row in rows:
            table.add_row(*(escape(cell) for cell in row))
        console.print(table)
        console.print()


def print_scoreboard(run, answer_key, console=None):
    console = console or Console()
    console.print(f"\n[bold]Evaluation {run['run_id']}[/bold]\n")
    _print_sections(console, sections(run, answer_key))


def _markdown_table(columns, rows):
    def cell(text):
        return str(text).replace("|", "\\|").replace("\n", " ")

    header = columns if any(columns) else [" "] * len(columns)
    lines = ["| " + " | ".join(cell(c) for c in header) + " |", "|" + "---|" * len(columns)]
    lines.extend("| " + " | ".join(cell(c) for c in row) + " |" for row in rows)
    return lines


def write_report(run, answer_key, path):
    """Writes the scoreboard and the detail of every question, with the retrieved chunks."""
    items = answer_key.by_id()
    lines = [f"# Evaluation {run['run_id']}", ""]
    for title, columns, rows in sections(run, answer_key):
        lines += [f"## {title}", "", *_markdown_table(columns, rows), ""]

    lines += ["## All questions", ""]
    for result in run["results"]:
        item = items[result["item_id"]]
        status = "right" if result["passed"] else f"WRONG ({CAUSE_LABELS.get(result['cause'], '—')})"
        lines += [
            f"### {item.id}: {status}",
            "",
            f"- **Question:** {item.question}",
            f"- **Answer:** {' '.join(result['answer'].split())}",
            f"- **Expected:** {describe_expected(item)}",
        ]
        problem = describe_problem(result)
        if problem:
            lines.append(f"- **Detail:** {problem}")
        if result["judge"]:
            verdicts = ", ".join(
                f"{CRITERIA[name]['label'].lower()} {'yes' if v['verdict'] else 'no' if v['verdict'] is False else '?'}"
                for name, v in result["judge"].items()
            )
            lines.append(f"- **Judge:** {verdicts}")
        lines.append(f"- **Time:** {result['latency_s']:.1f} s")
        lines += ["", "Chunks sent to the model:", ""]
        for chunk in result["retrieved"]["fused"]:
            lines += [f"{chunk['rank']}.", "", "   ```text", *("   " + line for line in chunk["content"].splitlines()), "   ```"]
        lines.append("")

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def print_comparison(comparison, console=None, questions=None):
    """Regressions first, even when the overall score went up."""
    console = console or Console()
    questions = questions or {}
    console.print(f"\n[bold]Comparison[/bold]: {comparison['base']} (base) → {comparison['candidate']}\n")
    if not comparison["comparable"]:
        console.print(f"[red]Not comparable:[/red] {comparison['reason']}")
        return
    for warning in comparison["warnings"]:
        console.print(f"[yellow]Warning:[/yellow] {warning}\n")

    regressions = comparison["regressions"]
    if regressions:
        table = Table(title=f"REGRESSIONS: {len(regressions)} questions went from right to wrong",
                      title_justify="left", title_style="bold red", header_style="bold")
        for column in ("Item", "Question", "Cause now"):
            table.add_column(column, overflow="fold")
        for entry in regressions:
            table.add_row(entry["item_id"], escape(questions.get(entry["item_id"], "")), CAUSE_LABELS.get(entry["cause"], "—"))
        console.print(table)
    else:
        console.print("[green]No regression:[/green] no question went from right to wrong.")
    console.print()

    if comparison["config_changes"]:
        table = Table(title="What changed in the assistant", title_justify="left", header_style="bold")
        for column in ("Parameter", "Base", "Now"):
            table.add_column(column)
        for field, change in comparison["config_changes"].items():
            table.add_row(field, str(change["base"]), str(change["candidate"]))
        console.print(table)
    else:
        console.print("Assistant configuration: no recorded changes.")
    console.print()

    table = Table(title="Metrics", title_justify="left", header_style="bold")
    for column in ("Metric", "Base", "Now", "Difference", ""):
        table.add_column(column)
    for name, entry in comparison["metric_deltas"].items():
        if name.startswith(("retrieval.vector", "retrieval.bm25")):
            continue
        delta = entry["delta"]
        # a difference smaller than the scoreboard can show counts as equal
        tolerance = 0.05 if name.startswith("operational.") else 0.005 if name.endswith(".mrr") else 0.0005
        changed = delta is not None and abs(delta) >= tolerance
        note = ""
        if changed and comparison["within_noise"].get(name):
            note = "within the variation"
        elif changed:
            better = (delta < 0) == (name in LOWER_IS_BETTER)
            note = "[green]better[/green]" if better else "[red]worse[/red]"
        difference = "—" if delta is None else _delta(name, delta) if changed else "="
        table.add_row(metric_label(name), _value(name, entry["base"]), _value(name, entry["candidate"]),
                      difference, note)
    console.print(table)
    console.print()

    improvements = comparison["improvements"]
    if improvements:
        table = Table(title=f"Improvements: {len(improvements)} questions went from wrong to right",
                      title_justify="left", title_style="bold green", header_style="bold")
        for column in ("Item", "Question", "Cause before"):
            table.add_column(column, overflow="fold")
        for entry in improvements:
            table.add_row(entry["item_id"], escape(questions.get(entry["item_id"], "")),
                          CAUSE_LABELS.get(entry["previous_cause"], "—"))
        console.print(table)
        console.print()


def print_retrieval(summary, misses, console=None):
    console = console or Console()
    labels = {"hit": "Hit", "recall": "Recall", "mrr": "MRR", "context_precision": "Context precision",
              "anchored": "Anchored evidence"}
    table = Table(title="Search (answerable questions, dev subset)", title_justify="left", header_style="bold")
    table.add_column("Source")
    for label in labels.values():
        table.add_column(label)
    for source, values in summary.items():
        table.add_row(SOURCE_LABELS[source], *(f"{values[name]:.2f}" if name == "mrr" else pct(values[name]) for name in labels))
    console.print(table)
    console.print()
    if not misses:
        console.print("[green]The evidence reached the model in every question.[/green]")
    for miss in misses:
        console.print(f"[red]✗[/red] [bold]{miss['item_id']}[/bold]: {escape(miss['question'])}")
        console.print("    Retrieved: " + escape(" | ".join(title[:40] for title in miss["retrieved"])))


def print_kb_report(report, console=None, strategy=None, stale_reason=None):
    console = console or Console()
    mismatch = report["source_mismatch"]
    name = f" (strategy {strategy})" if strategy else ""
    console.print(f"\n[bold]Knowledge base{name}[/bold]: {report['chunk_count']} chunks in the vector base\n")
    if stale_reason:
        console.print(f"[yellow]Warning:[/yellow] {escape(stale_reason)}\n")

    duplicates = report["duplicates"]
    console.print(f"[bold]Duplicate chunks:[/bold] {len(duplicates)}")
    for entry in duplicates:
        console.print(f"  - {entry['count']}x: {escape(_short(entry['content'], 100))}")

    unanchored = report["unanchored"]
    console.print(f"[bold]Facts with no chunk that names the procedure:[/bold] {len(unanchored)}")
    for entry in unanchored:
        reason = ("no chunk contains the whole evidence" if entry["kind"] == "missing"
                  else f"no chunk with the evidence names \"{entry['procedure']}\"")
        console.print(f"  - {entry['item_id']}: \"{escape(entry['evidence'])}\" ({reason})")

    corrupted = report["corrupted"]
    console.print(f"[bold]Chunks with corrupted text:[/bold] {len(corrupted)}")
    for code in sorted({code for entry in corrupted for code in entry["chars"]}):
        holders = [entry["content"] for entry in corrupted if code in entry["chars"]]
        position = holders[0].index(chr(int(code[2:], 16)))
        excerpt = " ".join(holders[0][max(0, position - 30):position + 30].split())
        console.print(f"  - {code} in {len(holders)} chunk(s), for example: \"…{escape(excerpt)}…\"")

    console.print(
        f"[bold]Vector base x chunk file:[/bold] "
        + ("equal" if not mismatch["mismatch"] else
           f"DIFFERENT ({mismatch['vector_count']} in the vector base, {mismatch['file_count']} in the file; "
           f"{mismatch['only_in_vector']} only in the base, {mismatch['only_in_file']} only in the file)")
    )
    console.print()


INDEX_STATE_LABELS = {
    "current": "[green]current[/green]",
    "stale": "[yellow]out of date[/yellow]",
    "missing": "[red]missing[/red]",
}
SCORE_NOTE = (
    "Score measures how similar the chunks are to the question, not whether they are right: True Rate measures hits. "
    "It is only comparable between experiments with the same embedding model and the same HyDE option."
)


def print_settings(settings, index_states, console=None):
    """Strategies (with the state of the index of each one) and declared experiments."""
    console = console or Console()
    table = Table(title="Chunking strategies", title_justify="left", header_style="bold")
    for column in ("Name", "Type", "Parameters", "Index"):
        table.add_column(column)
    for name, strategy in settings.strategies.items():
        state, _ = index_states[name]
        parameters = ", ".join(f"{key} {value}" for key, value in strategy.parameters.items()) or "—"
        table.add_row(name, strategy.type, parameters, INDEX_STATE_LABELS[state])
    console.print(table)
    for name, (state, reason) in index_states.items():
        if reason:
            console.print(f"  {escape(reason)}")

    table = Table(title="Experiments", title_justify="left", header_style="bold")
    for column in ("Name", "Strategy", "Search", "Chunks", "Threshold", "HyDE", "Prompt", "Assistant"):
        table.add_column(column, no_wrap=True)
    for name, experiment in settings.experiments.items():
        mark = "← in use" if name == settings.assistant.exp_name else ""
        table.add_row(name, experiment.collection, experiment.search_type, str(experiment.match_count),
                      f"{experiment.match_threshold:.2f}", str(experiment.use_hyde), experiment.prompt, mark)
    console.print(table)


def experiments_table(results):
    """Text lines of the comparison table, with fixed width: nothing is cut on a narrow terminal."""
    header = ("Experiment", "Strategy", "Collection", "Threshold", "Count", "HyDE", "Score", "True Rate", "Anchored", "Time")
    rows = []
    for result in results:
        experiment = result.experiment
        done = result.status == "ok"
        rows.append((
            experiment.exp_name,
            experiment.search_type,
            experiment.collection,
            f"{experiment.match_threshold:.2f}",
            str(experiment.match_count),
            str(experiment.use_hyde),
            f"{result.score:.2f}" if done else "-",
            f"{result.hits}/{result.total}" if done else "-",
            pct(result.anchored_rate) if done else "-",
            f"{result.avg_latency_ms:.0f} ms" if done else "-",
        ))
    widths = [max(len(row[i]) for row in [header, *rows]) + 2 for i in range(len(header))]
    rule = "|" + "|".join("-" * width for width in widths) + "|"
    line = lambda cells: "|" + "|".join(cell.center(width) for cell, width in zip(cells, widths)) + "|"  # noqa: E731
    return [rule, line(header), rule, *(line(row) for row in rows), rule]


def print_experiments(results, console=None):
    """Comparison table of the bench. results comes already sorted (evaluation.experiments.sort_results)."""
    console = console or Console()
    table = experiments_table(results)
    plain = dict(highlight=False, markup=False, soft_wrap=True)
    console.print()
    console.print("=" * len(table[0]), **plain)
    console.print("COMPARISON OF RETRIEVAL STRATEGIES", **plain)
    console.print("=" * len(table[0]), **plain)
    for row in table:
        console.print(row, **plain)
    console.print("Sorted by True Rate, then by Score (on a tie, experiments with HyDE come after).", **plain)

    for result in results:
        if result.status != "ok":
            label = "not run" if result.status == "not_run" else "incomplete"
            console.print(f"[yellow]{result.experiment.exp_name} ({label}):[/yellow] {escape(result.reason)}")
    console.print(f"\n{SCORE_NOTE}\n", highlight=False)


def print_coverage(summary, console=None):
    console = console or Console()
    console.print(f"{summary['total']} questions, {summary['unanswerable']} with no answer in the brochure, "
                  f"{summary['smoke']} in the quick evaluation")
    console.print("By subset: " + ", ".join(f"{name} {count}" for name, count in summary["by_split"].items()))
    console.print("By type: " + ", ".join(
        f"{CATEGORY_LABELS[name].lower()} {count}" for name, count in summary["by_category"].items()))
    console.print("By procedure: " + ", ".join(
        f"{name} {count}" for name, count in summary["by_procedure"].items()))
