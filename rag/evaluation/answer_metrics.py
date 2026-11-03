"""Deterministic metrics of the answer: facts, numeric faithfulness, refusal, and service rules.

Each function takes the Locale of the answer key's language (evaluation/normalize.py); English by default.
The phrases that show a refusal and the terms the assistant must not say are in the Locale: adjust them there
when the prompt changes.
"""
import re

from evaluation.normalize import EN, canonical_text, extract_values, normalize_text

MAX_ANSWER_CHARS = 1200


def check_facts(answer, expected_facts, locale=EN):
    """For each expected fact, says whether the answer contains it."""
    values = {v.key for v in extract_values(answer, locale)}
    text = canonical_text(answer, locale)
    found = []
    for fact in expected_facts:
        if fact.type == "text":
            ok = any(canonical_text(alternative, locale) in text for alternative in fact.alternatives)
        else:
            ok = all(target in values for target in fact.targets())
        found.append({"label": fact.label, "found": ok})
    return found


def unexpected_values(answer, known_facts, kinds=None, locale=EN):
    """Money, duration, or clock time values of the answer that do not belong to the known facts.

    kinds limits the check to some kinds ("money", "duration", "time"); None checks all of them.
    """
    known = {target for fact in known_facts for target in fact.targets()}
    labels = []
    for value in extract_values(answer, locale):
        if kinds is not None and value.kind not in kinds:
            continue
        if value.key not in known and value.label not in labels:
            labels.append(value.label)
    return labels


def ungrounded_values(answer, chunks, locale=EN):
    """Values of the answer that do not appear in any retrieved chunk."""
    grounded = {v.key for chunk in chunks for v in extract_values(chunk, locale)}
    labels = []
    for value in extract_values(answer, locale):
        if value.key not in grounded and value.label not in labels:
            labels.append(value.label)
    return labels


def factual_ok(answer, expected_facts, allowed_facts=(), locale=EN):
    """Every expected fact present and no stray value of the same kinds."""
    kinds = {fact.type for fact in expected_facts if fact.type != "text"}
    return all(f["found"] for f in check_facts(answer, expected_facts, locale)) and not unexpected_values(
        answer, [*expected_facts, *allowed_facts], kinds, locale
    )


def detect_abstention(answer, locale=EN):
    text = normalize_text(answer)
    return any(pattern in text for pattern in locale.abstention_patterns)


def check_rules(answer, locale=EN):
    """Service rules with an objective answer. Returns the violations."""
    text = normalize_text(answer)
    violations = []
    for term, pattern in locale.forbidden_terms.items():
        if re.search(pattern, text):
            violations.append(f"forbidden_term:{term}")
    if len(answer) > MAX_ANSWER_CHARS:
        violations.append("too_long")
    words = re.findall(r"[a-z]+", text)
    if sum(w in locale.other_language_words for w in words) > sum(w in locale.language_words for w in words):
        violations.append(locale.wrong_language)
    return violations
