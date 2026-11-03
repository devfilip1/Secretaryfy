import hashlib

from assistant.composition import build_knowledge_source
from assistant.ingest import build_chunks
from assistant.ingestion.markdown_source import MarkdownKnowledgeSource, parse_sections
from assistant.ingestion.source import Section
from assistant.settings import Strategy

SECTION = Strategy("section", "section", {"max_chars": 1200, "overlap": 100})
BROCHURE_MD = "data/source/dentalsafe.md"


def test_each_heading_starts_a_section_and_the_lines_below_are_its_body():
    text = "# Clinic\n\nignored intro\n## First\nline a\n\n- item\n## Second\nline b\n"

    assert parse_sections("## First\nline a\n\n- item\n## Second\nline b\n") == (
        Section("First", ("line a", "- item")),
        Section("Second", ("line b",)),
    )
    assert parse_sections(text)[0].title == "First"  # what comes before the first "## " is left out


def test_the_source_versions_the_file_by_content(tmp_path):
    path = tmp_path / "clinic.md"
    path.write_text("## Cleaning\nPrice: R$ 150\n", encoding="utf-8")
    source = MarkdownKnowledgeSource(path, name="clinic.md")

    document = source.load()

    assert document.version == source.version() == hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    assert document.name == "clinic.md"
    assert document.sections == (Section("Cleaning", ("Price: R$ 150",)),)
    assert document.pages == ("Cleaning\nPrice: R$ 150",)


def test_the_brochure_in_markdown_gives_the_same_chunks_as_the_pdf():
    """If it fails, dentalsafe.md and DentalSafe.pdf no longer say the same thing."""
    pdf = build_knowledge_source().load()
    markdown = MarkdownKnowledgeSource(BROCHURE_MD, name=pdf.name).load()

    from_pdf = [(chunk.page_content, chunk.metadata) for chunk in build_chunks(SECTION, pdf)]
    from_markdown = [(chunk.page_content, chunk.metadata) for chunk in build_chunks(SECTION, markdown)]

    assert len(from_pdf) == 11
    assert from_markdown == from_pdf
