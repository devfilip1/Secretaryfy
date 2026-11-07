"""Golden test: the prompts, the cleaned answers and the tokens of the assistant (DentalSafe, English).

The fixtures in tests/unit/golden/ were recorded from the code before the clinic profile existed, and they are the
reference for the refactoring: with the DentalSafe profile and English, every value here must stay identical.
Regenerate them only when a change of wording is intended: UPDATE_GOLDEN=1 python -m pytest tests/unit/test_prompt_golden.py
"""
import json
import os
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

from assistant.clinic.yaml_source import YamlClinicProfile
from assistant.config import CLINIC_PATH, LANGUAGES_DIR
from assistant.retrieval.pipeline import RagConfig, build_prompt, clean_answer, hypothetical_answer, prompt_text, standalone_question, tokenize

GOLDEN_DIR = Path(__file__).parent / "golden"

CLEANING = "Dental Cleaning — The First Step Toward a Healthy Smile\nDuration: 30–50 minutes\nPrice: $40–$85"
IMPLANTS = "Dental Implants — Tooth Back\nA titanium post\nDuration: 3–6 months"

CONFIG = RagConfig(experiment="test", strategy="fake", search_type="hybrid", match_count=4, match_threshold=0.0,
                   use_hyde=False, prompt="rules")
ORIGINAL = replace(CONFIG, prompt="original")

TWO_TURNS = [
    {"role": "user", "content": "Do you offer a cleaning?"},
    {"role": "assistant", "content": "Yes, we do!\n\nIt takes 30–50 minutes."},
]
MESSY_HISTORY = [
    {"role": "user", "content": "  Hello  there\n"},
    {"role": "assistant", "content": "Hi!\n\nWe\nare open."},
    {"role": "system", "content": "an unexpected role"},
    {"role": "user", "content": "   "},
]


# The calls of the code as it is now. The clinic profile is the only thing added to them; the expected values above
# do not change with it.
CLINIC = YamlClinicProfile(CLINIC_PATH, LANGUAGES_DIR).load()


def build(question, retrieval, config, history=None):
    return build_prompt(question, retrieval, config, CLINIC, history)


def standalone(question, history, config, generator):
    return standalone_question(question, history, config, generator, CLINIC)


def hyde(question, config, generator):
    return hypothetical_answer(question, config, generator, CLINIC)


def clean(text, history=None):
    return clean_answer(text, CLINIC, history)


def text_of_prompt(config):
    return prompt_text(config, CLINIC)


def chunks(*contents):
    return SimpleNamespace(fused=[SimpleNamespace(content=content, rank=rank) for rank, content in enumerate(contents, 1)])


class RecordingGenerator:
    """Answers with a fixed text and keeps the prompts it was given."""

    def __init__(self, reply="rewritten question"):
        self.reply, self.prompts = reply, []

    def generate(self, prompt, *, model, temperature, seed, max_tokens):
        self.prompts.append(prompt)
        return self.reply


def messages(value):
    return [{"type": message.type, "content": message.content} for message in value.to_messages()]


def prompt_cases():
    generator = RecordingGenerator()
    standalone("how much does it cost?", TWO_TURNS, CONFIG, generator)
    return {
        "rules_first_question_with_chunks": messages(build("How much is a cleaning?", chunks(CLEANING, IMPLANTS), CONFIG)),
        "rules_two_turns": messages(build("how much does it cost?", chunks(CLEANING), CONFIG, TWO_TURNS)),
        "rules_messy_history": messages(build("Is it open?", chunks(IMPLANTS), CONFIG, MESSY_HISTORY)),
        "rules_without_chunks": messages(build("How much is a cleaning?", chunks(), CONFIG)),
        "rules_without_chunks_with_history": messages(build("And braces?", chunks(), CONFIG, TWO_TURNS)),
        "original_with_chunks": messages(build("How much is a cleaning?", chunks(CLEANING, IMPLANTS), ORIGINAL)),
        "original_without_chunks": messages(build("How much is a cleaning?", chunks(), ORIGINAL)),
        "standalone_rewrite_prompt": generator.prompts,
        "prompt_text_rules": text_of_prompt(CONFIG),
        "prompt_text_original": text_of_prompt(ORIGINAL),
    }


def hyde_prompt_text():
    generator = RecordingGenerator("A hypothetical text.")
    hyde("How much is a dental implant?", CONFIG, generator)
    return generator.prompts


def answer_cases():
    cases = {
        "note_after_separator": ("Yes, we do! It costs $40–$85.\n\n---\n\n(Note: I didn't invite the customer to schedule.)", None),
        "note_without_separator": ("Yes, we do!\n\nNote: bring your ID.", None),
        "two_messages_kept": ("Yes, we do!\n\nIt costs $40–$85.", None),
        "greeting_first_message": ("Hi! How can I help?", None),
        "greeting_ongoing": ("Hi!\n\nYes, this is DentalSafe.", TWO_TURNS),
        "hello_there_ongoing": ("Hello there, we are open on Saturdays.", TWO_TURNS),
        "greeting_only_ongoing": ("Hi!", TWO_TURNS),
        "hey_lowercase_ongoing": ("hey, sure thing", TWO_TURNS),
        "word_starting_like_greeting": ("Highly recommended.", TWO_TURNS),
        "dash_line_in_the_middle": ("Braces cost $180–$450.\n----\nmore text", None),
        "note_inline_not_removed": ("We close at 5 p.m. (note: weekdays only)", None),
        "indented_note": ("Yes.\n   NOTE: x", None),
        "only_spaces": ("   ", TWO_TURNS),
        "greeting_then_nothing_with_note": ("Hi!\n\nNote: nothing else", TWO_TURNS),
    }
    return {name: clean(text, history) for name, (text, history) in cases.items()}


TOKEN_SENTENCES = [
    "How much does Whitening cost?",
    "How many sessions are needed for the veneers?",
    "painless process, address",
    "Can you pull a tooth?",
    "Where are you?",
    "Are you open on Saturday?",
    "What's your phone number?",
    "How long does the result last?",
    "How long until I recover?",
    "I have a cavity",
    "the cost and the price",
    "Do you do braces or aligners? Invisalign, please!",
    "Quanto custa a limpeza dental? Ação, café e Ça va?",
    "Are the weekends open? Are the hours closed on Sunday?",
    "",
]


def token_cases():
    return {
        sentence: {"plain": tokenize(sentence, CLINIC.lexicon), "expanded": tokenize(sentence, CLINIC.lexicon, expand=True)}
        for sentence in TOKEN_SENTENCES
    }


def check_golden(name, actual):
    path = GOLDEN_DIR / name
    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    assert json.loads(path.read_text(encoding="utf-8")) == actual


def test_prompts_match_the_golden_fixture():
    check_golden("prompts.json", prompt_cases())


def test_hyde_prompt_matches_the_golden_fixture():
    check_golden("hyde.json", {"prompts": hyde_prompt_text()})


def test_cleaned_answers_match_the_golden_fixture():
    check_golden("answers.json", answer_cases())


def test_tokens_match_the_golden_fixture():
    check_golden("tokens.json", token_cases())
