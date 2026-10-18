"""Text normalization and extraction of values (money, durations, and clock times) in US English."""
import re
import unicodedata
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

# unit in the answer key -> (factor, canonical unit)
FACT_UNITS = {
    "minute": (1, "minute"), "hour": (60, "minute"), "day": (1440, "minute"),
    "month": (1, "month"), "year": (12, "month"),
    "session": (1, "session"), "visit": (1, "visit"),
}

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
_QUOTES = {ord("’"): "'", ord("‘"): "'", ord("“"): '"', ord("”"): '"'}

_WORD = re.compile(r"[a-z]+")
_NUMBER = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
_DIGITS_THOUSAND = re.compile(r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:k|thousand)\b")
_UNIT = re.compile(r"\s*-?\s*(" + "|".join(sorted(UNIT_WORDS, key=len, reverse=True)) + r")\b")
_MONEY_BEFORE = re.compile(r"(?:\$|\busd)\s*$")
_MONEY_AFTER = re.compile(r"\s*(?:dollars?|bucks|usd)\b")
_RANGE_BETWEEN = re.compile(r"\s*(?:to|and|or|-|up to)\s*\$?\s*")
_RANGE_AFTER_ONE = re.compile(r"\s*(?:(?:to|or|-)\s*(?:\d|" + "|".join(NUMBER_WORDS) + r")|-?\s*(?:" + "|".join(UNIT_WORDS) + r")\b)")
# "9:00 am", "9 am", "9am", "2 p.m." (12-hour clock) or "18:00" (24-hour clock)
_TIME = re.compile(
    r"(?<![\d:.,$])(?:(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\b\.?|([01]?\d|2[0-3]):([0-5]\d))(?![\d:])"
)


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


def _parse_number(raw):
    return float(raw.replace(",", ""))


def _format_number(value):
    return f"{value:g}" if value != int(value) else str(int(value))


def format_money(value):
    """1500 -> '$1,500'; 99.9 -> '$99.90'."""
    return f"${int(value):,}" if value == int(value) else f"${value:,.2f}"


def format_time(minutes):
    """540 -> '9:00 AM'; 1080 -> '6:00 PM'."""
    hour, minute = divmod(int(minutes), 60)
    return f"{hour % 12 or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


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
    """Replaces numbers written in words with digits. Expects already normalized text."""
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


def canonical_text(text):
    """Normalized text, with '2.5k' and numbers written in words converted to digits."""
    text = normalize_text(text)
    text = _DIGITS_THOUSAND.sub(lambda m: _format_number(_parse_number(m.group(1)) * 1000), text)
    return replace_number_words(text)


def _clock_times(text):
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


def extract_values(text):
    """Returns the money, duration, and clock time values of the text, in the order they appear."""
    text = canonical_text(text)
    times = _clock_times(text)
    found = [[start, end, minutes, "time", None, format_time(minutes)] for start, end, minutes in times]

    numbers = []  # [start, end, number, kind, unit, label]
    for match in _NUMBER.finditer(text):
        if any(start <= match.start() < end for start, end, _ in times):
            continue  # the digits of a clock time are not a number of their own
        number = _parse_number(match.group())
        kind = unit = label = None
        unit_match = _UNIT.match(text, match.end())
        if _MONEY_BEFORE.search(text[:match.start()]) or _MONEY_AFTER.match(text, match.end()):
            kind = "money"
        elif unit_match:
            kind = "duration"
            factor, unit = UNIT_WORDS[unit_match.group(1)]
            label = f"{_format_number(number)} {unit_match.group(1)}"
            number *= factor
        numbers.append([match.start(), match.end(), number, kind, unit, label])

    # ranges: "30-50 minutes", "900 to 2,000 dollars", "$900-2,000"
    for first, second in zip(numbers, numbers[1:]):
        if not _RANGE_BETWEEN.fullmatch(text[first[1]:second[0]]):
            continue
        if first[3] is None and second[3] == "money":
            first[3] = "money"
        elif first[3] is None and second[3] == "duration":
            unit_word = second[5].split(" ", 1)[1]
            factor, unit = UNIT_WORDS[unit_word]
            first[3:] = ["duration", unit, f"{_format_number(first[2])} {unit_word}"]
            first[2] *= factor
        elif second[3] is None and first[3] == "money":
            second[3] = "money"

    values = []
    for _, _, number, kind, unit, label in sorted(found + numbers, key=lambda entry: entry[0]):
        if kind == "money":
            values.append(Value("money", number, None, format_money(number)))
        elif kind in ("duration", "time"):
            values.append(Value(kind, number, unit, label))
    return values


def extract_money(text):
    return [v.value for v in extract_values(text) if v.kind == "money"]


def extract_durations(text):
    return [(v.value, v.unit) for v in extract_values(text) if v.kind == "duration"]


def extract_times(text):
    return [v.value for v in extract_values(text) if v.kind == "time"]


def words_to_number(text):
    """Converts a number written in words ('one thousand five hundred') into a number; None if it is not one."""
    converted = replace_number_words(normalize_text(text))
    return _parse_number(converted) if _NUMBER.fullmatch(converted) else None
