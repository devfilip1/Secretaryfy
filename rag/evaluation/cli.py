"""Command line of the evaluation: python -m evaluation <command>."""
import argparse
import json
import sys
from datetime import datetime

from rich.console import Console
from rich.markup import escape
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeElapsedColumn

from evaluation import calibrate, history, report
from evaluation.aggregate import aggregate, variance
from evaluation.compare import compare
from evaluation.dataset import AnswerKeyError, coverage, load_answer_key, load_source_text, select_subset, validate
from assistant.settings import SettingsError

EXIT_OK, EXIT_ERROR, EXIT_USAGE = 0, 1, 2

console = Console()


class UsageError(Exception):
    pass


def _load_valid_answer_key():
    """Loads and validates the answer key; shows the problems and returns None if it is invalid."""
    try:
        answer_key = load_answer_key()
        problems = validate(answer_key, load_source_text())
    except AnswerKeyError as error:
        answer_key, problems = None, error.problems
    if problems:
        console.print(f"[red]Invalid answer key:[/red] {len(problems)} problem(s)")
        for problem in problems:
            console.print(f"  - {escape(problem)}")
        return None
    return answer_key


def _experiment(name):
    """Experiment by name, or the assistant's. An unknown name becomes a usage error with the list of valid ones."""
    from assistant import settings

    if name is None:
        return settings.assistant_experiment()
    try:
        return settings.get_experiment(name)
    except KeyError as error:
        raise UsageError(error.args[0]) from error


def _strategy(name):
    from assistant import settings

    try:
        return settings.get_strategy(name)
    except KeyError as error:
        raise UsageError(error.args[0]) from error


def _require_index(strategy_name):
    """Returns the reason if the index of the strategy cannot be used, or None."""
    from assistant.index import CURRENT, index_state

    state, reason = index_state(_strategy(strategy_name))
    return None if state == CURRENT else reason


def cmd_validate(args):
    from assistant import settings
    from assistant.index import index_state

    loaded = settings.load_settings()  # an invalid configuration leaves through the SettingsError handling in main()
    answer_key = _load_valid_answer_key()
    if answer_key is None:
        return EXIT_USAGE
    console.print("[green]Valid configuration[/green] (config/strategies.yaml and config/experiments.yaml)")
    states = {name: index_state(strategy) for name, strategy in loaded.strategies.items()}
    report.print_settings(loaded, states, console)
    console.print(f"\n[green]Valid answer key[/green] (version {answer_key.version})")
    report.print_coverage(coverage(answer_key), console)
    return EXIT_OK


def _questions(answer_key):
    return {item.id: item.question for item in answer_key.items}


def cmd_run(args):
    answer_key = _load_valid_answer_key()
    if answer_key is None:
        return EXIT_USAGE

    from assistant.config import OLLAMA_BASE_URL
    from assistant.pipeline import RagConfig

    from evaluation.judge import judge_model_name, make_judge
    from evaluation.runner import eval_config, preflight, run_evaluation, warm_up

    experiment = _experiment(args.experiment)
    unavailable = _require_index(experiment.collection)
    if unavailable:
        console.print(f"[red]Error:[/red] {escape(unavailable)}")
        return EXIT_ERROR
    config = eval_config(RagConfig.from_experiment(experiment))
    judge_model = None if args.no_judge else judge_model_name(config.chat_model)

    problems = preflight([config.chat_model, config.embedding_model, *([judge_model] if judge_model else [])],
                         OLLAMA_BASE_URL)
    if problems:
        for problem in problems:
            console.print(f"[red]Error:[/red] {problem}")
        return EXIT_ERROR

    try:
        warm_up(config)
    except Exception as error:
        console.print(f"[red]Error:[/red] the assistant did not answer: {escape(f'{type(error).__name__}: {error}')}")
        return EXIT_ERROR

    subset = "smoke" if args.smoke else "holdout" if args.holdout else "dev"
    items = select_subset(answer_key, subset)
    judge_fn = make_judge(judge_model, OLLAMA_BASE_URL) if judge_model else None
    started_at = datetime.now().astimezone()

    with Progress(TextColumn("{task.description}"), BarColumn(), MofNCompleteColumn(), TimeElapsedColumn(),
                  console=console) as progress:
        task = progress.add_task(f"Evaluating ({report.SUBSET_LABELS[subset]})", total=len(items) * args.repeat)
        outcome = run_evaluation(items, answer_key, config, judge_fn, args.repeat, lambda: progress.advance(task))

    items_by_id = answer_key.by_id()
    agreement = calibrate.load_agreement(judge_model) if judge_model else {}
    repetitions = outcome["repetitions"]
    complete = outcome["status"] == "complete"
    run = {
        "run_id": history.new_run_id(args.label, started_at),
        "started_at": started_at.isoformat(timespec="seconds"),
        "finished_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "status": outcome["status"],
        "subset": subset,
        "answer_key_version": answer_key.version,
        "answer_key_hash": answer_key.hash,
        "config": history.snapshot_config(config, judge_model),
        "repeat": args.repeat,
        "results": repetitions[0],
        "metrics": aggregate(repetitions[0], items_by_id, agreement),
        "skipped": outcome["skipped"],
    }
    if complete and args.repeat > 1:
        run["variance"] = variance([aggregate(results, items_by_id) for results in repetitions])

    folder = history.save_run(run)
    if not complete:
        console.print(f"\n[red]Incomplete evaluation:[/red] {escape(outcome['error'])}")
        console.print(f"{len(run['skipped'])} question(s) not evaluated: {', '.join(run['skipped'])}")
        console.print(f"Partial result saved in {folder} (outside the history).")
        return EXIT_ERROR

    report.write_report(run, answer_key, folder / "report.md")
    report.print_scoreboard(run, answer_key, console)
    console.print(f"Saved in {folder}\n")

    baseline_id = history.get_baseline(subset)
    if baseline_id and baseline_id != run["run_id"]:
        try:
            base = history.load_run(baseline_id)
        except FileNotFoundError:
            console.print(f"[yellow]Warning:[/yellow] the reference {baseline_id} was not found.")
        else:
            report.print_comparison(compare(base, run), console, _questions(answer_key))
    elif subset in history.BASELINE_SUBSETS and not baseline_id:
        console.print("There is no reference for this subset yet. To mark this run: "
                      "python -m evaluation baseline set")
    return EXIT_OK


def cmd_retrieval(args):
    from evaluation import experiments as bench

    experiment = _experiment(args.experiment)
    answer_key = _load_valid_answer_key()
    if answer_key is None:
        return EXIT_USAGE

    result = bench.run_experiment(experiment, bench.select_items(answer_key), answer_key)
    if result.status != bench.OK:
        console.print(f"[red]Error:[/red] {escape(result.reason)}")
        return EXIT_ERROR
    console.print(f"Experiment [bold]{experiment.exp_name}[/bold] (strategy {experiment.collection}, "
                  f"{experiment.search_type} search, up to {experiment.match_count} chunks)\n")
    report.print_retrieval(bench.source_summary(result), bench.misses(result), console)
    return EXIT_OK


def cmd_experiments(args):
    from assistant import settings
    from assistant.config import OLLAMA_BASE_URL, OLLAMA_CHAT_MODEL, OLLAMA_EMBEDDING_MODEL

    from evaluation import experiments as bench
    from evaluation.runner import preflight

    chosen = [_experiment(name) for name in args.names] if args.names else settings.experiments()
    answer_key = _load_valid_answer_key()
    if answer_key is None:
        return EXIT_USAGE

    models = [OLLAMA_EMBEDDING_MODEL] + ([OLLAMA_CHAT_MODEL] if any(e.use_hyde for e in chosen) else [])
    problems = preflight(models, OLLAMA_BASE_URL)
    if problems:
        for problem in problems:
            console.print(f"[red]Error:[/red] {problem}")
        return EXIT_ERROR

    items = bench.select_items(answer_key)
    started_at = datetime.now()
    results = []
    for experiment in chosen:
        with Progress(TextColumn("{task.description}"), BarColumn(), MofNCompleteColumn(), TimeElapsedColumn(),
                      console=console) as progress:
            task = progress.add_task(f"Retrieving and evaluating ({experiment.exp_name})", total=len(items))
            on_question = None
            if args.verbose:
                on_question = lambda question: progress.console.print(  # noqa: E731
                    escape(bench.format_question_line(question)), highlight=False, soft_wrap=True)
            results.append(bench.run_experiment(
                experiment, items, answer_key, on_progress=lambda: progress.advance(task), on_question=on_question))

    ordered = bench.sort_results(results)
    report.print_experiments(ordered, console)
    summary_path, questions_path = bench.write_csv(ordered, started_at, answer_key.version, OLLAMA_EMBEDDING_MODEL)
    console.print(f"Results saved in:\n  {summary_path}\n  {questions_path}\n")
    return EXIT_OK if any(result.status == bench.OK for result in results) else EXIT_ERROR


def _resolve_pair(args):
    if args.base and args.candidate:
        return history.load_run(args.base), history.load_run(args.candidate)
    if args.base:
        candidate = history.load_run(args.base)
    else:
        candidate = history.latest_run("dev")
        if candidate is None:
            raise UsageError("there is no complete evaluation of the dev subset")
    baseline_id = history.get_baseline(candidate["subset"])
    if not baseline_id:
        raise UsageError(f"there is no reference for the {candidate['subset']} subset; "
                         "set one with: python -m evaluation baseline set")
    if baseline_id == candidate["run_id"]:
        raise UsageError(f"the most recent evaluation ({baseline_id}) is the reference itself; "
                         "run a new evaluation or name the two runs")
    return history.load_run(baseline_id), candidate


def cmd_compare(args):
    base, candidate = _resolve_pair(args)
    comparison = compare(base, candidate)
    try:
        questions = _questions(load_answer_key())
    except (AnswerKeyError, OSError):
        questions = {}
    report.print_comparison(comparison, console, questions)
    return EXIT_OK if comparison["comparable"] else EXIT_USAGE


def cmd_baseline(args):
    if args.action == "show":
        found = False
        for subset in history.BASELINE_SUBSETS:
            run_id = history.get_baseline(subset)
            if run_id:
                found = True
                console.print(f"Reference ({subset}): {run_id}")
        if not found:
            console.print("No reference set.")
        return EXIT_OK

    run_id = args.run_id
    if run_id is None:
        runs = [run for run in history.list_runs() if run["subset"] in history.BASELINE_SUBSETS]
        if not runs:
            raise UsageError("there is no complete evaluation to set as the reference")
        run_id = runs[0]["run_id"]
    try:
        run = history.set_baseline(run_id)
    except ValueError as error:
        raise UsageError(str(error)) from error
    console.print(f"Reference of the {run['subset']} subset: {run_id} "
                  f"(overall score {report.pct(run['metrics']['overall']['pass_rate'])})")
    return EXIT_OK


def cmd_list(args):
    runs = history.list_runs()
    if not runs:
        console.print("No complete evaluation saved.")
        return EXIT_OK
    baselines = {history.get_baseline(subset) for subset in history.BASELINE_SUBSETS}
    for run in runs:
        mark = "  ← reference" if run["run_id"] in baselines else ""
        console.print(f"{run['run_id']:<45} {run['subset']:<8} answer key {run['answer_key_version']:<14} "
                      f"score {report.pct(run['metrics']['overall']['pass_rate']):>6}{mark}")
    return EXIT_OK


def cmd_kb_check(args):
    from evaluation import kb_checks

    from assistant.index import MISSING, index_state

    strategy = _strategy(args.strategy or _experiment(None).collection)
    state, reason = index_state(strategy)
    if state == MISSING:
        console.print(f"[red]Error:[/red] {escape(reason)}")
        return EXIT_ERROR
    try:
        answer_key = load_answer_key()
        vector_chunks, file_chunks = kb_checks.load_kb(strategy.name)
    except (AnswerKeyError, OSError, ValueError) as error:
        console.print(f"[red]Error:[/red] could not read the knowledge base: {escape(str(error))}")
        return EXIT_ERROR
    checks = kb_checks.run_checks(answer_key, vector_chunks, file_chunks)
    report.print_kb_report(checks, console, strategy=strategy.name, stale_reason=reason)
    return EXIT_OK


def cmd_calibrate(args):
    if args.action == "export":
        run = history.load_run(args.run_id) if args.run_id else next(
            (run for run in history.list_runs() if run["config"]["judge_model"]), None)
        if run is None or not run["config"]["judge_model"]:
            raise UsageError("there is no evaluation with the judge; run: python -m evaluation run")
        sample = calibrate.export_sample(run, load_answer_key().by_id(), args.size)
        console.print(f"{len(sample['samples'])} answers from {run['run_id']} saved in {calibrate.LABELS_PATH}")
        console.print("Fill the \"human\" fields with true or false and run: python -m evaluation calibrate score")
        return EXIT_OK

    if not calibrate.LABELS_PATH.is_file():
        raise UsageError("there is no sample; run: python -m evaluation calibrate export")
    labels = json.loads(calibrate.LABELS_PATH.read_text(encoding="utf-8"))
    agreement = calibrate.score_agreement(labels, history.load_run(labels["run_id"]))
    if not any(entry["compared"] for entry in agreement["criteria"].values()):
        raise UsageError(f"no \"human\" field filled in {calibrate.LABELS_PATH}")
    calibrate.save_agreement(agreement)
    console.print(f"Agreement between the person and the judge ({agreement['judge_model']}):")
    for name, entry in agreement["criteria"].items():
        status = "[green]reliable[/green]" if entry["reliable"] else "[red]NOT RELIABLE[/red]"
        pending = f", {entry['unfilled']} not filled" if entry["unfilled"] else ""
        console.print(f"  {report.CRITERIA[name]['label']:<28} {report.pct(entry['agreement']):>6} "
                      f"over {entry['compared']} answers{pending}  {status}")
    return EXIT_OK


def build_parser():
    parser = argparse.ArgumentParser(prog="python -m evaluation", description="Evaluation of the DentalSafe assistant")
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="run the evaluation and save the result")
    subset = run.add_mutually_exclusive_group()
    subset.add_argument("--smoke", action="store_true", help="only the questions of the quick evaluation")
    subset.add_argument("--holdout", action="store_true", help="only the reserved part")
    run.add_argument("--repeat", type=int, default=1, metavar="N", help="run N times and report the variation")
    run.add_argument("--no-judge", action="store_true", help="skip the judge metrics")
    run.add_argument("--label", metavar="TEXT", help="label added to the run id")
    run.add_argument("--experiment", metavar="NAME",
                     help="experiment from config/experiments.yaml to evaluate (default: the assistant's)")
    run.set_defaults(handler=cmd_run)

    comparison = commands.add_parser("compare", help="compare two evaluations")
    comparison.add_argument("base", nargs="?")
    comparison.add_argument("candidate", nargs="?")
    comparison.set_defaults(handler=cmd_compare)

    baseline = commands.add_parser("baseline", help="set or show the reference evaluation")
    baseline.add_argument("action", choices=("set", "show"))
    baseline.add_argument("run_id", nargs="?")
    baseline.set_defaults(handler=cmd_baseline)

    retrieval = commands.add_parser("retrieval", help="measure the search only, without generating answers")
    retrieval.add_argument("--experiment", metavar="NAME", help="experiment to detail (default: the assistant's)")
    retrieval.set_defaults(handler=cmd_retrieval)

    bench = commands.add_parser("experiments", help="run the search experiments and show the comparison table")
    bench.add_argument("names", nargs="*", metavar="NAME", help="experiments to run (default: all)")
    bench.add_argument("--verbose", action="store_true", help="show one line per question: question;hit;score")
    bench.set_defaults(handler=cmd_experiments)

    commands.add_parser("list", help="list the complete evaluations").set_defaults(handler=cmd_list)
    kb_check = commands.add_parser("kb-check", help="check the knowledge base")
    kb_check.add_argument("--strategy", metavar="NAME", help="strategy to check (default: the assistant's)")
    kb_check.set_defaults(handler=cmd_kb_check)
    commands.add_parser("validate", help="validate the configuration and the answer key").set_defaults(handler=cmd_validate)

    calibration = commands.add_parser("calibrate", help="check the judge against a person")
    calibration.add_argument("action", choices=("export", "score"))
    calibration.add_argument("run_id", nargs="?")
    calibration.add_argument("--size", type=int, default=20)
    calibration.set_defaults(handler=cmd_calibrate)
    return parser


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    if getattr(args, "repeat", 1) < 1:
        console.print("[red]Error:[/red] --repeat must be 1 or more")
        return EXIT_USAGE
    try:
        return args.handler(args)
    except SettingsError as error:
        console.print(f"[red]Invalid configuration:[/red] {len(error.problems)} problem(s)")
        for problem in error.problems:
            console.print(f"  - {escape(problem)}")
        return EXIT_USAGE
    except (UsageError, FileNotFoundError) as error:
        console.print(f"[red]Error:[/red] {escape(str(error))}")
        return EXIT_USAGE
