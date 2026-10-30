import pytest

from assistant.ingest import build_chunks, clean_text, is_heading, load_pages, split_sections
from assistant.settings import SettingsError, Strategy

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


def test_vectorize_chunks_uses_the_injected_store_rebuild_operation(monkeypatch):
    from assistant import ingest

    strategy = Strategy("section", "section", {"max_chars": 1200, "overlap": 100})
    chunks = [build_chunks(strategy, PAGES)[0]]
    calls = []

    class FakeStore:
        def rebuild(self, documents):
            calls.append(("rebuild", documents))

    def provider(name):
        calls.append(("provider", name))
        return FakeStore()

    ingest.vectorize_chunks(strategy, chunks, vector_store_provider=provider)

    assert calls == [("provider", "section"), ("rebuild", chunks)]


def test_ingest_cli_forwards_vector_store_provider_through_index_build(monkeypatch, capsys):
    from types import SimpleNamespace

    from assistant import ingest
    from assistant import ingestion

    strategy = Strategy("fake", "page", {})
    documents = []
    calls = []

    class FakeStore:
        def rebuild(self, chunks):
            documents.extend(chunks)

    def provider(name):
        calls.append(name)
        return FakeStore()

    monkeypatch.setattr(ingestion.service, "load_settings", lambda: SimpleNamespace(strategies={"fake": strategy}))
    monkeypatch.setattr(ingestion.service, "load_pages", lambda: ["Dental Cleaning\nPrice: $40–$85"])
    monkeypatch.setattr(ingestion.service, "save_chunks", lambda strategy, chunks: None)
    monkeypatch.setattr(ingestion.service, "write_manifest", lambda *args, **kwargs: None)

    result = ingest.main(["fake"], vector_store_provider=provider)

    assert result == 0
    assert calls == ["fake"]
    assert len(documents) == 1 and "$40–$85" in documents[0].page_content
    assert "fake: 1 chunks" in capsys.readouterr().out


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


PAGE = Strategy("page", "page", {})


def test_ingest_cli_rejects_an_unknown_strategy_before_reading_the_brochure(monkeypatch, capsys):
    from types import SimpleNamespace

    from assistant import ingest
    from assistant import ingestion

    monkeypatch.setattr(ingestion.service, "load_settings", lambda: SimpleNamespace(strategies={"section": SECTION, "page": PAGE}))
    monkeypatch.setattr(ingestion.service, "load_pages", lambda: pytest.fail("must not read the brochure"))

    result = ingest.main(["section", "bogus"], vector_store_provider=lambda name: pytest.fail("must not open a store"))

    assert result == 2
    assert capsys.readouterr().out.strip() == "Unknown strategy: bogus. Use one of: section, page"


def test_build_index_records_the_dimensions_of_the_stored_vectors(monkeypatch, tmp_path):
    import json

    from assistant import index as index_module
    from assistant import ingestion

    class FakeStore:
        def rebuild(self, chunks):
            pass

        def vectors_by_content(self):
            return {"chunk": [0.1, 0.2, 0.3]}

    monkeypatch.setattr(index_module, "INDEX_DIR", tmp_path)  # the files go to tmp_path, not data/
    monkeypatch.setattr(index_module, "source_hash", lambda path=None: "pdf-1")

    ingestion.service.build_index(SECTION, PAGES, vector_store_provider=lambda name: FakeStore())

    manifest = json.loads((tmp_path / "section" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["embedding_dimensions"] == 3


def test_build_index_leaves_the_dimensions_out_when_the_store_cannot_tell(monkeypatch, tmp_path):
    import json

    from assistant import index as index_module
    from assistant import ingestion

    class BareStore:
        def rebuild(self, chunks):
            pass

    monkeypatch.setattr(index_module, "INDEX_DIR", tmp_path)
    monkeypatch.setattr(index_module, "source_hash", lambda path=None: "pdf-1")

    ingestion.service.build_index(SECTION, PAGES, vector_store_provider=lambda name: BareStore())

    manifest = json.loads((tmp_path / "section" / "manifest.json").read_text(encoding="utf-8"))
    assert "embedding_dimensions" not in manifest


def test_ingest_cli_stops_with_the_configuration_problems(monkeypatch, capsys):
    from assistant import ingest
    from assistant import ingestion

    def invalid():
        raise SettingsError(["strategies.yaml: first problem", "strategies.yaml: second problem"])

    monkeypatch.setattr(ingestion.service, "load_settings", invalid)

    result = ingest.main(["section"], vector_store_provider=lambda name: pytest.fail("must not open a store"))

    assert result == 2
    assert capsys.readouterr().out.strip() == (
        "Invalid configuration: 2 problem(s)\n"
        "  - strategies.yaml: first problem\n"
        "  - strategies.yaml: second problem"
    )


def test_ingestion_main_requires_an_explicit_vector_store_provider():
    from assistant.ingestion import service

    with pytest.raises(TypeError):
        service.main(["section"])


def test_ingest_cli_uses_the_composition_root_when_no_provider_is_given(monkeypatch, tmp_path):
    from types import SimpleNamespace

    from assistant import index as index_module
    from assistant import ingest
    from assistant import ingestion

    names = []
    store = SimpleNamespace(rebuild=lambda chunks: None)
    monkeypatch.setattr(ingest, "build_vector_store_provider", lambda: lambda name: names.append(name) or store)
    monkeypatch.setattr(index_module, "INDEX_DIR", tmp_path)
    monkeypatch.setattr(ingestion.service, "load_settings", lambda: SimpleNamespace(strategies={"page": PAGE}))
    monkeypatch.setattr(ingestion.service, "load_pages", lambda: PAGES)
    monkeypatch.setattr(ingestion.service, "write_manifest", lambda strategy, count, **kwargs: None)

    result = ingest.main(["page"])

    assert result == 0
    assert names == ["page"]


def test_ingest_cli_builds_every_declared_index_into_its_own_folder(monkeypatch, tmp_path, capsys):
    from types import SimpleNamespace

    from assistant import index as index_module
    from assistant import ingest
    from assistant import ingestion

    rebuilt = {}

    class FakeStore:
        def __init__(self, name):
            self.name = name

        def rebuild(self, chunks):
            rebuilt[self.name] = len(chunks)

    manifests = []
    monkeypatch.setattr(index_module, "INDEX_DIR", tmp_path)  # the chunk files go to tmp_path, not data/
    monkeypatch.setattr(ingestion.service, "load_settings", lambda: SimpleNamespace(strategies={"section": SECTION, "page": PAGE}))
    monkeypatch.setattr(ingestion.service, "load_pages", lambda: PAGES)
    monkeypatch.setattr(ingestion.service, "write_manifest", lambda strategy, count, **kwargs: manifests.append((strategy.name, count)))

    result = ingest.main([], vector_store_provider=FakeStore)

    assert result == 0
    assert rebuilt == {"section": 5, "page": 2}
    assert manifests == [("section", 5), ("page", 2)]
    assert (tmp_path / "section" / "chunks.json").is_file()
    assert (tmp_path / "page" / "chunks.json").is_file()
    assert capsys.readouterr().out == (
        "section: 5 chunks in data/index/section/\n"
        "page: 2 chunks in data/index/page/\n"
    )
