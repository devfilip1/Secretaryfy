"""Deterministic metrics of the answer: facts, numeric faithfulness, refusal, and service rules."""
import re

from evaluation.normalize import canonical_text, extract_values, normalize_text

# Pieces (already normalized) that show the assistant said it does not have the information.
# The first entry is the sentence ordered by the prompt; adjust here when the prompt changes.
ABSTENTION_PATTERNS = (
    "i don't have that information",
    "i do not have that information",
    "don't have information",
    "do not have information",
    "don't have any information",
    "do not have any information",
    "no information",
    "not mentioned",
    "isn't mentioned",
    "couldn't find",
    "could not find",
    "i'm not able",
    "i am not able",
    "i'm unable",
    "i am unable",
    "i can't",
    "i cannot",
    "i'm not sure",
    "i am not sure",
)

FORBIDDEN_TERMS = {
    "according to": r"\baccording to\b",
    "context": r"\bcontexts?\b",
    "document": r"\bdocuments?\b",
    "brochure": r"\bbrochures?\b",
    "database": r"\bdata ?bases?\b",
    "provided information": r"\b(?:provided information|information provided|clinic information)\b",
}
MAX_ANSWER_CHARS = 1200

_PT_WORDS = {"o", "a", "de", "que", "e", "para", "com", "nao", "um", "uma", "os", "as", "do", "da", "em", "voce"}
_EN_WORDS = {"the", "is", "and", "of", "to", "you", "for", "with", "our", "your", "this", "that", "are", "can"}


def check_facts(answer, expected_facts):
    """For each expected fact, says whether the answer contains it."""
    values = {v.key for v in extract_values(answer)}
    text = canonical_text(answer)
    found = []
    for fact in expected_facts:
        if fact.type == "text":
            ok = any(canonical_text(alternative) in text for alternative in fact.alternatives)
        else:
            ok = all(target in values for target in fact.targets())
        found.append({"label": fact.label, "found": ok})
    return found


def unexpected_values(answer, known_facts, kinds=None):
    """Money, duration, or clock time values of the answer that do not belong to the known facts.

    kinds limits the check to some kinds ("money", "duration", "time"); None checks all of them.
    """
    known = {target for fact in known_facts for target in fact.targets()}
    labels = []
    for value in extract_values(answer):
        if kinds is not None and value.kind not in kinds:
            continue
        if value.key not in known and value.label not in labels:
            labels.append(value.label)
    return labels


def ungrounded_values(answer, chunks):
    """Values of the answer that do not appear in any retrieved chunk."""
    grounded = {v.key for chunk in chunks for v in extract_values(chunk)}
    labels = []
    for value in extract_values(answer):
        if value.key not in grounded and value.label not in labels:
            labels.append(value.label)
    return labels


def factual_ok(answer, expected_facts, allowed_facts=()):
    """Every expected fact present and no stray value of the same kinds."""
    kinds = {fact.type for fact in expected_facts if fact.type != "text"}
    return all(f["found"] for f in check_facts(answer, expected_facts)) and not unexpected_values(
        answer, [*expected_facts, *allowed_facts], kinds
    )


def detect_abstention(answer):
    text = normalize_text(answer)
    return any(pattern in text for pattern in ABSTENTION_PATTERNS)


def check_rules(answer):
    """Service rules with an objective answer. Returns the violations."""
    text = normalize_text(answer)
    violations = []
    for term, pattern in FORBIDDEN_TERMS.items():
        if re.search(pattern, text):
            violations.append(f"forbidden_term:{term}")
    if len(answer) > MAX_ANSWER_CHARS:
        violations.append("too_long")
    words = re.findall(r"[a-z]+", text)
    if sum(w in _PT_WORDS for w in words) > sum(w in _EN_WORDS for w in words):
        violations.append("not_english")
    return violations
