import pytest

from assistant.ingest import build_chunks, clean_text, is_heading, load_pages, split_sections
from assistant.settings import Strategy

B = "\x7f"  # list marker as it comes out of the PDF

# Page text as it comes out of the DentalSafe brochure: a running header with the marker and the page number,
# markers on the same line as the item, field labels in capitals, and a closing note.
PAGE_1 = f"""DentalSafe  {B}  1
 DentalSafe
 Transform Your Smile with Safety, Speed, and Guaranteed Results
LOCATION
125 Ocean Avenue, Suite 204
Miami, FL 33139, USA
HOURS
Monday–Friday: 9:00 AM–6:00 PM
Saturday: 9:00 AM–2:00 PM
Sunday: Closed
CONTACT
(305) 555-0148
appointments@dentalsafe.example
At DentalSafe, every treatment is planned to deliver visible results, comfort throughout the process, and maximum
durability.
Dental Cleaning — The First Step Toward a Healthy Smile
What you gain:
{B}  An immediate feeling of a clean mouth
{B}  Fresher breath
How it works: Removal of plaque and tartar using ultrasound, followed by polishing.
Duration: 30–50 minutes   |   Price: $40–$85
Dental Implants — Get Your Tooth Back Permanently
Ideal for people who want to:
{B}  Chew confidently again
"""
PAGE_2 = f"""DentalSafe  {B}  2
How it works: A titanium post placed in the bone, topped with a natural-looking prosthetic tooth.
Duration: 3–6 months   |   Price: $900–$2,000
Why Choose DentalSafe?
{B}  Fast appointments (within 72 hours)
{B}  Convenient payment options
Schedule Your Assessment Today
The longer you wait, the bigger the problem—and the higher the cost—may become. At DentalSafe, you can address
everything from basic care to comprehensive treatments with safety and predictable outcomes.
Note: The clinic address, contact details, opening hours, and prices in this sample brochure are fictional and should be verified or replaced before
publication.
"""
PAGES = [PAGE_1, PAGE_2]

SECTION = Strategy("section", "section", {"max_chars": 1200, "overlap": 100})
CLINIC = "DentalSafe — Clinic Information"
CLEANING = "Dental Cleaning — The First Step Toward a Healthy Smile"
IMPLANTS = "Dental Implants — Get Your Tooth Back Permanently"


@pytest.mark.parametrize(
    "line",
    [
        "Dental Cleaning — The First Step Toward a Healthy Smile",
        "Dental Filling — Treat Cavities Before They Become a Bigger Problem",
        "Braces and Orthodontic Treatment — A Straight, Harmonious Smile",
        "Why Choose DentalSafe?",
        "Schedule Your Assessment Today",
    ],
)
def test_headings(line):
    assert is_heading(line)


@pytest.mark.parametrize(
    "line",
    [
        "Duration: 30–50 minutes   |   Price: $40–$85",
        "Ideal for people who want to:",
        "- An immediate feeling of a clean mouth",
        "- Impacted wisdom teeth",
        "- Modern Technology and Patient Comfort",
        "Planning with predictable outcomes",
        "publication.",
        "Permanently",
        "LOCATION",
        "125 Ocean Avenue, Suite 204",
        "Miami, FL 33139, USA",
        "(305) 555-0148",
        "appointments@dentalsafe.example",
        "durability. You are not just undergoing a procedure—you are investing in self-esteem, health, and confidence in your",
    ],
)
def test_body_lines_are_not_headings(line):
    assert not is_heading(line)


def test_clean_text_turns_markers_into_list_items():
    cleaned = clean_text(PAGE_2)

    assert B not in cleaned
    assert "- Fast appointments (within 72 hours)\n- Convenient payment options" in cleaned
    assert "Price: $900–$2,000" in cleaned
    assert "\n\n" not in cleaned


def test_clean_text_accepts_a_marker_alone_on_its_line():
    cleaned = clean_text(f"Why Choose DentalSafe?\n{B}\nFast appointments\n{B}\nConvenient payment options\n")

    assert cleaned == "Why Choose DentalSafe?\n- Fast appointments\n- Convenient payment options"


def test_clean_text_drops_the_page_header():
    assert clean_text(PAGE_1).splitlines()[0] == "DentalSafe"
    assert clean_text(PAGE_2).splitlines()[0].startswith("How it works:")


def test_clean_text_drops_the_closing_note_and_its_continuation():
    cleaned = clean_text(PAGE_2)

    assert "Note:" not in cleaned and "fictional" not in cleaned and "publication" not in cleaned
    assert cleaned.endswith("with safety and predictable outcomes.")


def test_an_ignored_paragraph_ends_at_the_next_heading_or_list():
    cleaned = clean_text(f"Note: something to leave out\nthat goes on here.\nWhy Choose DentalSafe?\n{B}  Fast appointments\n")

    assert cleaned == "Why Choose DentalSafe?\n- Fast appointments"


def test_sections_follow_the_headings_across_pages():
    text = "\n".join(clean_text(page) for page in PAGES)

    sections = dict(split_sections(text))

    assert list(sections) == [CLINIC, CLEANING, IMPLANTS, "Why Choose DentalSafe?", "Schedule Your Assessment Today"]
    assert sections[CLEANING] == [
        "What you gain:",
        "- An immediate feeling of a clean mouth",
        "- Fresher breath",
        "How it works: Removal of plaque and tartar using ultrasound, followed by polishing.",
        "Duration: 30–50 minutes   |   Price: $40–$85",
    ]


def test_the_opening_block_becomes_the_clinic_section():
    text = "\n".join(clean_text(page) for page in PAGES)

    clinic = dict(split_sections(text))[CLINIC]

    assert clinic[0] == "Transform Your Smile with Safety, Speed, and Guaranteed Results"  # the tagline is body, not a title
    for line in ("LOCATION", "125 Ocean Avenue, Suite 204", "Miami, FL 33139, USA", "HOURS", "Saturday: 9:00 AM–2:00 PM",
                 "CONTACT", "(305) 555-0148", "appointments@dentalsafe.example"):
        assert line in clinic


def test_a_title_that_wraps_into_two_lines_is_joined():
    sections = split_sections("Dental Implants — Get Your Tooth Back\nPermanently\nIdeal for people who want to:\n- Chew again")

    assert sections == [("Dental Implants — Get Your Tooth Back Permanently", ["Ideal for people who want to:", "- Chew again"])]


def test_a_document_that_opens_with_a_heading_has_no_clinic_section():
    sections = split_sections("Dental Cleaning — The First Step\nPrice: $40–$85")

    assert sections == [("Dental Cleaning — The First Step", ["Price: $40–$85"])]


def test_section_strategy_keeps_each_value_with_its_treatment():
    chunks = build_chunks(SECTION, PAGES)

    assert len(chunks) == 5
    implants = chunks[2]
    assert implants.page_content.startswith(IMPLANTS + "\n")
    assert "$900–$2,000" in implants.page_content  # the section starts on one page and ends on the next
    assert "$40" not in implants.page_content
    assert implants.metadata == {"source": "data/source/DentalSafe.pdf", "strategy": "section", "section": IMPLANTS}


def test_section_larger_than_the_limit_is_split_with_the_title_repeated():
    body = "\n".join(f"Detail {n}: " + "information about the treatment " * 5 for n in range(20))
    small = Strategy("small", "section", {"max_chars": 400, "overlap": 50})

    chunks = build_chunks(small, [f"Long Treatment — A Large Example\n{body}\n"])

    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.page_content.startswith("Long Treatment — A Large Example\n")
        assert len(chunk.page_content) <= 400 + len("Long Treatment — A Large Example\n")


def test_split_strategy_respects_the_chunk_size_and_uses_clean_text():
    strategy = Strategy("recursive_200_50", "split", {"chunk_size": 200, "chunk_overlap": 50})

    chunks = build_chunks(strategy, PAGES)

    assert len(chunks) > 3
    assert all(len(chunk.page_content) <= 200 for chunk in chunks)
    text = "\n".join(chunk.page_content for chunk in chunks)
    assert B not in text and "fictional" not in text and "titanium" in text
    assert chunks[0].metadata == {"source": "data/source/DentalSafe.pdf", "strategy": "recursive_200_50"}


def test_split_strategy_can_separate_a_value_from_its_treatment():
    strategy = Strategy("recursive_200_50", "split", {"chunk_size": 200, "chunk_overlap": 50})

    chunks = build_chunks(strategy, PAGES)

    with_price = [chunk.page_content for chunk in chunks if "$900–$2,000" in chunk.page_content]
    assert with_price and not any("Implants" in content for content in with_price)


def test_page_strategy_makes_one_chunk_per_page():
    chunks = build_chunks(Strategy("page", "page", {}), PAGES)

    assert [chunk.metadata["page"] for chunk in chunks] == [1, 2]
    assert chunks[0].page_content == clean_text(PAGE_1)
    assert chunks[1].metadata == {"source": "data/source/DentalSafe.pdf", "strategy": "page", "page": 2}


def test_unknown_strategy_type():
    with pytest.raises(ValueError, match="semantic"):
        build_chunks(Strategy("x", "semantic", {}), PAGES)


def test_the_real_brochure_gives_one_section_per_subject():
    chunks = build_chunks(SECTION, load_pages())

    assert [chunk.metadata["section"] for chunk in chunks] == [
        CLINIC,
        CLEANING,
        "Teeth Whitening — Whiter Teeth in Just a Few Days",
        "Dental Filling — Treat Cavities Before They Become a Bigger Problem",
        "Root Canal Treatment — Relieve Pain Without Losing the Tooth",
        IMPLANTS,
        "Braces and Orthodontic Treatment — A Straight, Harmonious Smile",
        "Tooth Extraction — Fast, Safe Relief",
        "Dental Veneers — Your Perfect Smile in Just a Few Days",
        "Why Choose DentalSafe?",
        "Schedule Your Assessment Today",
    ]
    for chunk in chunks:
        assert B not in chunk.page_content and "fictional" not in chunk.page_content
    assert "Recovery: 3–7 days" in chunks[7].page_content
