import pytest

from evaluation.normalize import (
    EN,
    PT,
    canonical_text,
    extract_durations,
    extract_money,
    extract_times,
    extract_values,
    format_money,
    format_time,
    locale_for,
    normalize_text,
    words_to_number,
)


def test_normalize_text_lowercases_strips_accents_and_collapses_spaces():
    assert normalize_text("  Dental\n  FILLING —  Café ") == "dental filling - cafe"


def test_normalize_text_uses_one_kind_of_dash_and_quote():
    assert normalize_text("$40–$85 — I don’t know") == "$40-$85 - i don't know"


@pytest.mark.parametrize(
    "text, expected",
    [
        ("$1,500", [1500]),
        ("$ 1500", [1500]),
        ("1500 dollars", [1500]),
        ("$1,500.00", [1500]),
        ("one thousand five hundred dollars", [1500]),
        ("Price: $40–$85", [40, 85]),
        ("Price: $900–$2,000", [900, 2000]),
        ("between $900 and $2,000", [900, 2000]),
        ("900 to 2,000 dollars", [900, 2000]),
        ("$900 to 2,000", [900, 2000]),
        ("$2.5k", [2500]),
        ("from 2 thousand to 6 thousand dollars", [2000, 6000]),
        ("$400–$950 per tooth", [400, 950]),
        ("Initial cost: $180–$450 | Monthly: $35–$90", [180, 450, 35, 90]),
        ("Simple extraction: $50–$90 | Wisdom tooth: $140–$400", [50, 90, 140, 400]),
        ("two thousand dollars", [2000]),
        ("one hundred and forty dollars", [140]),
        ("USD 85", [85]),
    ],
)
def test_extract_money(text, expected):
    assert extract_money(text) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Duration: 30–50 minutes", [(30, "minute"), (50, "minute")]),
        ("thirty to fifty minutes", [(30, "minute"), (50, "minute")]),
        ("1 hour", [(60, "minute")]),
        ("within 72 hours", [(4320, "minute")]),
        ("within 72h", [(4320, "minute")]),
        ("3 days", [(4320, "minute")]),
        ("up to 14 days", [(20160, "minute")]),
        ("2 weeks", [(20160, "minute")]),
        ("Duration: 3–6 months", [(3, "month"), (6, "month")]),
        ("durability of more than 10 years", [(120, "month")]),
        ("Duration: 1–3 sessions", [(1, "session"), (3, "session")]),
        ("Duration: 2–3 appointments", [(2, "visit"), (3, "visit")]),
        ("two or three visits", [(2, "visit"), (3, "visit")]),
        ("three years", [(36, "month")]),
        ("one to three sessions", [(1, "session"), (3, "session")]),
        ("just one session", [(1, "session")]),
        ("45 min", [(45, "minute")]),
        ("a 30-minute visit", [(30, "minute")]),
        ("Recovery: 3–7 days", [(4320, "minute"), (10080, "minute")]),
    ],
)
def test_extract_durations(text, expected):
    assert extract_durations(text) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Monday–Friday: 9:00 AM–6:00 PM", [540, 1080]),
        ("Saturday: 9:00 AM–2:00 PM", [540, 840]),
        ("from 9 am to 6 pm", [540, 1080]),
        ("9am-2pm", [540, 840]),
        ("We open at 9 a.m. and close at 6 p.m.", [540, 1080]),
        ("from 9:00 to 18:00", [540, 1080]),
        ("12 PM", [720]),
        ("12:30 am", [30]),
    ],
)
def test_extract_times(text, expected):
    assert extract_times(text) == expected


def test_a_clock_time_is_not_also_money_or_a_duration():
    values = extract_values("We open at 9:00 AM and a cleaning takes 30 minutes for $40.")

    assert [(v.kind, v.value) for v in values] == [("time", 540), ("duration", 30), ("money", 40)]


@pytest.mark.parametrize(
    "text",
    [
        "I don't have that information right now.",
        "Schedule an appointment and get a new smile.",
        "This is the one you need.",
        "Up to 8 shades whiter",
        "We have a 50% approval rate",
        "From the very first session",
        "(305) 555-0148",
        "125 Ocean Avenue, Suite 204",
        "Miami, FL 33139, USA",
        "appointments@dentalsafe.example",
        "We are open from 9 to 6.",
    ],
)
def test_text_without_money_duration_or_time(text):
    assert extract_values(text) == []


def test_money_and_duration_in_the_same_sentence_do_not_mix():
    values = extract_values("It costs $200–$500 and takes 1 to 3 sessions.")

    assert [(v.kind, v.value) for v in values] == [
        ("money", 200), ("money", 500), ("duration", 1), ("duration", 3),
    ]


def test_two_numbers_in_a_row_are_not_added_when_not_a_single_number():
    assert extract_durations("thirty fifty minutes") == [(50, "minute")]
    assert extract_durations("thirty or fifty minutes") == [(30, "minute"), (50, "minute")]


@pytest.mark.parametrize(
    "text, expected",
    [
        ("zero", 0), ("nineteen", 19), ("twenty-five", 25), ("twenty five", 25), ("one hundred", 100),
        ("one hundred and twenty", 120), ("five hundred", 500), ("one thousand", 1000),
        ("one thousand five hundred", 1500), ("two thousand five hundred", 2500), ("six thousand", 6000),
        ("twelve thousand three hundred and forty-five", 12345),
    ],
)
def test_words_to_number(text, expected):
    assert words_to_number(text) == expected


def test_words_to_number_rejects_text_that_is_not_a_number():
    assert words_to_number("whitening") is None


def test_canonical_text_keeps_the_pronoun_but_converts_a_range():
    assert canonical_text("This is the one you need") == "this is the one you need"
    assert canonical_text("One to three sessions") == "1 to 3 sessions"
    assert canonical_text("Up to eight shades whiter") == "up to 8 shades whiter"


def test_formatting():
    assert (format_money(1500), format_money(99.9)) == ("$1,500", "$99.90")
    assert (format_time(540), format_time(1080), format_time(0), format_time(750)) == ("9:00 AM", "6:00 PM", "12:00 AM", "12:30 PM")


PT_VALUES = [
    ("Preço: R$ 40 a R$ 85", [("money", 40), ("money", 85)]),
    ("R$ 900 a R$ 2.000", [("money", 900), ("money", 2000)]),
    ("R$900-2.000", [("money", 900), ("money", 2000)]),
    ("custa de 180 a R$ 450", [("money", 180), ("money", 450)]),
    ("R$ 99,90", [("money", 99.9)]),
    ("por R$ 1.500,50", [("money", 1500.5)]),
    ("R$ 2 mil", [("money", 2000)]),
    ("400 reais por dente", [("money", 400)]),
    ("Duração: 30 a 50 minutos", [("duration", 30), ("duration", 50)]),
    ("12 a 36 meses", [("duration", 12), ("duration", 36)]),
    ("até 14 dias", [("duration", 20160)]),
    ("1 a 3 sessões", [("duration", 1), ("duration", 3)]),
    ("2 a 3 consultas", [("duration", 2), ("duration", 3)]),
    ("durabilidade de mais de 10 anos", [("duration", 120)]),
    ("Segunda a sexta: 9h às 18h", [("time", 540), ("time", 1080)]),
    ("das 9h30 às 14:00", [("time", 570), ("time", 840)]),
]


@pytest.mark.parametrize("text, expected", PT_VALUES)
def test_portuguese_values(text, expected):
    assert [(v.kind, v.value) for v in extract_values(text, PT)] == expected


@pytest.mark.parametrize(
    "text",
    ["(21) 5555-0148", "Avenida Atlântica, 125, Sala 204", "Rio de Janeiro, RJ, 22010-000, Brasil", "Não tenho essa informação."],
)
def test_portuguese_text_without_money_duration_or_time(text):
    assert extract_values(text, PT) == []


def test_portuguese_formatting():
    assert (PT.format_money(1500), PT.format_money(99.9)) == ("R$ 1.500", "R$ 99,90")
    assert (PT.format_time(540), PT.format_time(1110)) == ("9h", "18h30")


def test_the_locale_is_chosen_by_language_and_an_unknown_one_is_refused():
    assert locale_for("pt") is PT and locale_for("en") is EN
    with pytest.raises(ValueError, match="fr"):
        locale_for("fr")
