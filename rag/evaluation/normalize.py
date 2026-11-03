"""Text normalization and extraction of values (money, durations, and clock times), by language.

The default is US English. A Locale holds what changes with the language: how numbers, money and clock times are
written, the words of the units, and the phrases the answer checks look for. Numbers written in words are read in
English only; in Portuguese the answer is expected to use digits.
"""
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass

UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
NUMBER_WORDS = {**UNITS, **TENS, "hundred": 100, "thousand": 1000}

# written unit -> (factor, canonical unit)
UNIT_WORDS = {
    "minute": (1, "minute"), "minutes": (1, "minute"), "min": (1, "minute"), "mins": (1, "minute"),
    "hour": (60, "minute"), "hours": (60, "minute"), "hr": (60, "minute"), "hrs": (60, "minute"), "h": (60, "minute"),
    "day": (1440, "minute"), "days": (1440, "minute"),
    "week": (10080, "minute"), "weeks": (10080, "minute"),
    "month": (1, "month"), "months": (1, "month"),
    "year": (12, "month"), "years": (12, "month"), "yr": (12, "month"), "yrs": (12, "month"),
    "session": (1, "session"), "sessions": (1, "session"),
    "appointment": (1, "visit"), "appointments": (1, "visit"), "visit": (1, "visit"), "visits": (1, "visit"),
}
# Portuguese, already without accents. "h" is not a unit here: "9h" is a clock time.
UNIT_WORDS_PT = {
    "minuto": (1, "minute"), "minutos": (1, "minute"), "min": (1, "minute"), "mins": (1, "minute"),
    "hora": (60, "minute"), "horas": (60, "minute"), "hr": (60, "minute"), "hrs": (60, "minute"),
    "dia": (1440, "minute"), "dias": (1440, "minute"),
    "semana": (10080, "minute"), "semanas": (10080, "minute"),
    "mes": (1, "month"), "meses": (1, "month"),
    "ano": (12, "month"), "anos": (12, "month"),
    "sessao": (1, "session"), "sessoes": (1, "session"),
    "consulta": (1, "visit"), "consultas": (1, "visit"), "visita": (1, "visit"), "visitas": (1, "visit"),
}

# unit in the answer key -> (factor, canonical unit)
FACT_UNITS = {
    "minute": (1, "minute"), "hour": (60, "minute"), "day": (1440, "minute"),
    "month": (1, "month"), "year": (12, "month"),
    "session": (1, "session"), "visit": (1, "visit"),
}

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
_QUOTES = {ord("’"): "'", ord("‘"): "'", ord("“"): '"', ord("”"): '"'}

_WORD = re.compile(r"[a-z]+")
_RANGE_AFTER_ONE = re.compile(r"\s*(?:(?:to|or|-)\s*(?:\d|" + "|".join(NUMBER_WORDS) + r")|-?\s*(?:" + "|".join(UNIT_WORDS) + r")\b)")
# "9:00 am", "9 am", "9am", "2 p.m." (12-hour clock) or "18:00" (24-hour clock)
_TIME = re.compile(
    r"(?<![\d:.,$])(?:(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\b\.?|([01]?\d|2[0-3]):([0-5]\d))(?![\d:])"
)
# "9h", "9h30" or "9:00" (24-hour clock)
_TIME_PT = re.compile(r"(?<![\d:.,$])([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))(?![\d:a-z])")


@dataclass(frozen=True)
class Value:
    kind: str  # "money", "duration", or "time"
    value: float
    unit: str | None  # canonical unit of the duration
    label: str  # how to show it on the scoreboard

    @property
    def key(self):
        return (self.kind, round(self.value, 2), self.unit)


def normalize_text(text):
    """Lower case, no accents, one kind of dash and of quote, single spaces."""
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.translate(_DASHES).translate(_QUOTES)
    return re.sub(r"\s+", " ", text).strip()


def _format_number(value):
    return f"{value:g}" if value != int(value) else str(int(value))


def format_money(value):
    """1500 -> '$1,500'; 99.9 -> '$99.90'."""
    return f"${int(value):,}" if value == int(value) else f"${value:,.2f}"


def format_time(minutes):
    """540 -> '9:00 AM'; 1080 -> '6:00 PM'."""
    hour, minute = divmod(int(minutes), 60)
    return f"{hour % 12 or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


def format_money_pt(value):
    """1500 -> 'R$ 1.500'; 99.9 -> 'R$ 99,90'."""
    text = f"{int(value):,}" if value == int(value) else f"{value:,.2f}"
    return "R$ " + text.replace(",", "_").replace(".", ",").replace("_", ".")


def format_time_pt(minutes):
    """540 -> '9h'; 1110 -> '18h30'."""
    hour, minute = divmod(int(minutes), 60)
    return f"{hour}h" if minute == 0 else f"{hour}h{minute:02d}"


def _clock_times_en(text):
    """Clock times of the text as (start, end, minutes after midnight)."""
    found = []
    for match in _TIME.finditer(text):
        hour12, minute12, half, hour24, minute24 = match.groups()
        if hour12 is not None:
            minutes = (int(hour12) % 12 + (12 if half == "p" else 0)) * 60 + int(minute12 or 0)
        else:
            minutes = int(hour24) * 60 + int(minute24)
        found.append((match.start(), match.end(), minutes))
    return found


def _clock_times_pt(text):
    return [
        (match.start(), match.end(), int(match.group(1)) * 60 + int(match.group(2) or match.group(3) or 0))
        for match in _TIME_PT.finditer(text)
    ]


def _unit_pattern(unit_words):
    return re.compile(r"\s*-?\s*(" + "|".join(sorted(unit_words, key=len, reverse=True)) + r")\b")


@dataclass(frozen=True)
class Locale:
    language: str
    unit_words: dict
    number: re.Pattern  # a number as it is written in the language
    parse_number: Callable[[str], float]
    digits_thousand: re.Pattern  # "2.5k", "2 mil"
    money_before: re.Pattern
    money_after: re.Pattern
    range_between: re.Pattern
    unit: re.Pattern
    clock_times: Callable[[str], list]
    format_money: Callable[[float], str]
    format_time: Callable[[int], str]
    reads_number_words: bool
    # pieces (already normalized) that show the assistant said it does not have the information
    abstention_patterns: tuple
    forbidden_terms: dict
    language_words: frozenset  # common words of the language of the answers
    other_language_words: frozenset  # common words of the language that must not be used
    wrong_language: str  # the rule violation when the answer is in the other language


EN = Locale(
    language="en",
    unit_words=UNIT_WORDS,
    number=re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"),
    parse_number=lambda raw: float(raw.replace(",", "")),
    digits_thousand=re.compile(r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:k|thousand)\b"),
    money_before=re.compile(r"(?:\$|\busd)\s*$"),
    money_after=re.compile(r"\s*(?:dollars?|bucks|usd)\b"),
    range_between=re.compile(r"\s*(?:to|and|or|-|up to)\s*\$?\s*"),
    unit=_unit_pattern(UNIT_WORDS),
    clock_times=_clock_times_en,
    format_money=format_money,
    format_time=format_time,
    reads_number_words=True,
    abstention_patterns=(
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
    ),
    forbidden_terms={
        "according to": r"\baccording to\b",
        "context": r"\bcontexts?\b",
        "document": r"\bdocuments?\b",
        "brochure": r"\bbrochures?\b",
        "database": r"\bdata ?bases?\b",
        "provided information": r"\b(?:provided information|information provided|clinic information)\b",
    },
    language_words=frozenset({"the", "is", "and", "of", "to", "you", "for", "with", "our", "your", "this", "that", "are", "can"}),
    other_language_words=frozenset({"o", "a", "de", "que", "e", "para", "com", "nao", "um", "uma", "os", "as", "do", "da", "em", "voce"}),
    wrong_language="not_english",
)

PT = Locale(
    language="pt",
    unit_words=UNIT_WORDS_PT,
    number=re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?"),
    parse_number=lambda raw: float(raw.replace(".", "").replace(",", ".")),
    digits_thousand=re.compile(r"(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)\s*(?:k|mil)\b"),
    money_before=re.compile(r"\br\$\s*$"),
    money_after=re.compile(r"\s*(?:reais|real)\b"),
    range_between=re.compile(r"\s*(?:a|e|ou|ate|-)\s*(?:r\$)?\s*"),
    unit=_unit_pattern(UNIT_WORDS_PT),
    clock_times=_clock_times_pt,
    format_money=format_money_pt,
    format_time=format_time_pt,
    reads_number_words=False,
    abstention_patterns=(
        "nao tenho essa informacao",
        "nao tenho informacao",
        "nao tenho nenhuma informacao",
        "sem informacao",
        "nao consta",
        "nao esta mencionado",
        "nao foi mencionado",
        "nao encontrei",
        "nao consigo",
        "nao posso",
        "nao tenho certeza",
    ),
    forbidden_terms={
        "de acordo com": r"\bde acordo com\b",
        "contexto": r"\bcontextos?\b",
        "documento": r"\bdocumentos?\b",
        "folheto": r"\bfolhetos?\b",
        "banco de dados": r"\bbancos? de dados\b",
        "informacoes fornecidas": r"\b(?:informacoes fornecidas|informacoes da clinica)\b",
    },
    language_words=frozenset({"o", "a", "de", "que", "e", "para", "com", "nao", "um", "uma", "os", "as", "do", "da", "em", "voce"}),
    other_language_words=frozenset({"the", "is", "and", "of", "to", "you", "for", "with", "our", "your", "this", "that", "are", "can"}),
    wrong_language="not_portuguese",
)

LOCALES = {"en": EN, "pt": PT}


def locale_for(language):
    if language not in LOCALES:
        raise ValueError(f'no evaluation locale for language "{language}"; use one of: {", ".join(LOCALES)}')
    return LOCALES[language]


def _parse_run(tokens, i, text):
    """Reads a number written in words starting at tokens[i]. Returns (value, next token, end position)."""
    total = current = 0
    last = None  # previous number word
    j = i
    end = tokens[i].start()
    while j < len(tokens):
        k = j
        if j > i:
            gap = text[end:tokens[j].start()].strip()
            if gap not in ("", "-"):
                break
            # "one hundred and fifty": the "and" only joins after hundred or thousand
            if tokens[j].group() == "and":
                follows = j + 1 < len(tokens) and not text[tokens[j].end():tokens[j + 1].start()].strip()
                if gap or last not in ("hundred", "thousand") or not follows:
                    break
                k = j + 1
        word = tokens[k].group()
        if word not in NUMBER_WORDS:
            break
        number = NUMBER_WORDS[word]
        if word == "thousand":
            total += (current or 1) * 1000
            current = 0
        elif word == "hundred":
            if last is not None and last not in UNITS:
                break
            current = (current or 1) * 100
        else:
            # "thirty fifty" are two numbers, not 80; "twenty five" is 25
            joins = last is None or last in ("hundred", "thousand") or (last in TENS and word in UNITS and 0 < number < 10)
            if not joins:
                break
            current += number
        last = word
        end = tokens[k].end()
        j = k + 1
    return total + current, j, end


def replace_number_words(text):
    """Replaces numbers written in words with digits (English). Expects already normalized text."""
    tokens = list(_WORD.finditer(text))
    pieces = []
    pos = 0
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.group() not in NUMBER_WORDS or token.start() < pos:
            i += 1
            continue
        value, next_i, end = _parse_run(tokens, i, text)
        single = next_i == i + 1
        # "one" alone is a pronoun ("the one you need"), unless a unit or a range follows ("one to three", "one session")
        if single and token.group() == "one" and not _RANGE_AFTER_ONE.match(text, end):
            i += 1
            continue
        pieces.append(text[pos:token.start()])
        pieces.append(str(value))
        pos = end
        i = next_i
    pieces.append(text[pos:])
    return "".join(pieces)


def canonical_text(text, locale=EN):
    """Normalized text, with '2.5k' and, in English, numbers written in words converted to digits."""
    text = normalize_text(text)
    text = locale.digits_thousand.sub(lambda m: _format_number(locale.parse_number(m.group(1)) * 1000), text)
    return replace_number_words(text) if locale.reads_number_words else text


def extract_values(text, locale=EN):
    """Returns the money, duration, and clock time values of the text, in the order they appear."""
    text = canonical_text(text, locale)
    times = locale.clock_times(text)
    found = [[start, end, minutes, "time", None, locale.format_time(minutes)] for start, end, minutes in times]

    numbers = []  # [start, end, number, kind, unit, label]
    for match in locale.number.finditer(text):
        if any(start <= match.start() < end for start, end, _ in times):
            continue  # the digits of a clock time are not a number of their own
        number = locale.parse_number(match.group())
        kind = unit = label = None
        unit_match = locale.unit.match(text, match.end())
        if locale.money_before.search(text[:match.start()]) or locale.money_after.match(text, match.end()):
            kind = "money"
        elif unit_match:
            kind = "duration"
            factor, unit = locale.unit_words[unit_match.group(1)]
            label = f"{_format_number(number)} {unit_match.group(1)}"
            number *= factor
        numbers.append([match.start(), match.end(), number, kind, unit, label])

    # ranges: "30-50 minutes", "900 to 2,000 dollars", "$900-2,000"
    for first, second in zip(numbers, numbers[1:]):
        if not locale.range_between.fullmatch(text[first[1]:second[0]]):
            continue
        if first[3] is None and second[3] == "money":
            first[3] = "money"
        elif first[3] is None and second[3] == "duration":
            unit_word = second[5].split(" ", 1)[1]
            factor, unit = locale.unit_words[unit_word]
            first[3:] = ["duration", unit, f"{_format_number(first[2])} {unit_word}"]
            first[2] *= factor
        elif second[3] is None and first[3] == "money":
            second[3] = "money"

    values = []
    for _, _, number, kind, unit, label in sorted(found + numbers, key=lambda entry: entry[0]):
        if kind == "money":
            values.append(Value("money", number, None, locale.format_money(number)))
        elif kind in ("duration", "time"):
            values.append(Value(kind, number, unit, label))
    return values


def extract_money(text, locale=EN):
    return [v.value for v in extract_values(text, locale) if v.kind == "money"]


def extract_durations(text, locale=EN):
    return [(v.value, v.unit) for v in extract_values(text, locale) if v.kind == "duration"]


def extract_times(text, locale=EN):
    return [v.value for v in extract_values(text, locale) if v.kind == "time"]


def words_to_number(text):
    """Converts a number written in words ('one thousand five hundred') into a number; None if it is not one."""
    converted = replace_number_words(normalize_text(text))
    return EN.parse_number(converted) if EN.number.fullmatch(converted) else None
