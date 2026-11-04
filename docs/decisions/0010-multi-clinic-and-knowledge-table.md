# 0010 · Many clinics, with each clinic's knowledge in a table

**Status:** Proposed · **Date:** 2026-11-03

## Context
Secretaryfy serves one clinic from one machine ([ADR 0007](0007-single-process-in-memory-coordination.md)). What the assistant answers from is a file: a PDF brochure, or a Markdown file in the tests. The clinic's identity and language are files too (`config/clinics/<clinic>.yaml`, `config/languages/<language>.yaml`). No table has a clinic id.

The plan is to serve many clinics and to let each one configure its own content through the panel (issue 7, "Conhecimento"). The PDF will never be the source of truth. Since Stage 6b the RAG already has the contract this needs: a `KnowledgeSource` returns a `KnowledgeDocument` (name, version, sections), and chunking, indexing and the manifest know nothing about where the sections came from ([ADR 0009](0009-rag-composition-root.md)).

## Decision (proposed)
1. **The clinic is an entity.** A `clinics` table: slug, name, kind, language, and the words of its specialty for the word search. The language names a language package (`config/languages/<language>.yaml`), which stays a file because it is code-like text (prompts, refusal sentence, word lists).
2. **The knowledge is a table.** `knowledge_sections(id, clinic_id, title, body)`: one row is one subject of the brochure. The panel edits these rows. Markdown files are only a way to import them once. No `position` column: the order of creation is enough, because the search does not look at the order.
3. **A new source, no new pipeline.** `DbKnowledgeSource(clinic_id)` reads the rows of one clinic and returns a `KnowledgeDocument`. Its version is a hash of the rows, so any edit changes it and the manifest of that clinic's index asks for a reindex. Chunking, indexing, the search and the prompt do not change.
4. **One index per clinic.** The index folder includes the clinic (`<index>/<clinic slug>/<strategy>`). The RAG process keeps one service per clinic, created on first use by the composition root, and shares the embedding model and the chat model between them (the GPU holds one of each).
5. **Publishing reindexes.** An action of the panel (publish) tells the RAG service to reindex that clinic. For a brochure of about 30 chunks this takes seconds. A draft that is not published does not reach the assistant.
6. **The file-based profile stays.** `YamlClinicProfile` keeps working for tests and for a single clinic; a database implementation of `ClinicProfileSource` is added next to it.
7. **The RAG endpoints take the clinic.** The Node server already knows the clinic from the connected number; it passes the clinic id with each question.

## Alternatives considered
- **One deployment per clinic** (the code as it is, with its own database, WhatsApp number and index): the simplest and the most isolated, and no ADR 0007 problem. It costs a copy of everything per clinic, and each copy wants the models in memory, which the GPU cannot give.
- **Keep one file per clinic, edited by hand:** it works for a handful of clinics, but a clinic cannot edit its own prices.
- **Store the vectors in Postgres (`pgvector`) instead of Chroma:** possible later and independent of this decision; the table above is the text, and the vectors are always derived from it.

## Consequences
- The RAG side is cheap: a source, a registry of services by clinic and the index path. The contracts already exist.
- **The Node server is the hard part.** ADR 0007 keeps the send queue, the calendar lock, the SSE bus, the debouncer and the reminder timer in memory, for one clinic. With many clinics in one process each of them has to be keyed by the clinic, and the WhatsApp number, the Google Calendar connection and the anti-ban state have to belong to a clinic. This ADR does not decide that; it needs its own record.
- Every business table needs a clinic id and a migration of the existing data into a first clinic.
- A reindex runs inside the single RAG process, so a publish by one clinic briefly uses the GPU that the others answer with.

## Open questions
1. Many clinics in one Node process, or one process per clinic behind a router?
2. Who may edit the knowledge, and is there a draft, a history and a way to go back (`knowledge_versions`)?
3. How long are conversations kept (the retention question already open in the docs)?
4. Which chat model: the local one for every clinic, or a cloud model chosen per clinic. Patient messages would leave the machine, which is a decision about privacy (LGPD) and not only about quality.
5. Is the language of a clinic always one, or can a clinic answer in two?

**Evidence:** [ingestion/source.py](../../rag/assistant/ingestion/source.py), [ingestion/markdown_source.py](../../rag/assistant/ingestion/markdown_source.py), [composition.py](../../rag/assistant/composition.py), [clinic/yaml_source.py](../../rag/assistant/clinic/yaml_source.py), [ADR 0007](0007-single-process-in-memory-coordination.md), [ADR 0009](0009-rag-composition-root.md). Related issues: 4, 7, 9, 10.
