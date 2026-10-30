# 0009 · One composition root for the RAG service, with injected providers

**Status:** Accepted · **Date:** 2026-10-30

## Context
`rag/` started as a copy of RagLab. Its modules built their own dependencies: a global `EMBEDDINGS` created at import, a `get_vector_store` behind `lru_cache`, and entry points (server, chat, ingestion CLI) that each picked Chroma on their own. Tests could not swap the vector store or the embedding model without Chroma and Ollama running, ingestion and search shared the embedding model only by accident, and nothing stopped a search from comparing vectors of different sizes. The planned cloud work ([architecture](../architecture.md#planned-cloud-ready-dependency-composition)) needs providers to be replaceable.

## Decision
Each process has one composition root: [`rag/assistant/composition.py`](../../rag/assistant/composition.py). It is the only place that chooses concrete backends (`build_vector_store_provider`, `build_embeddings_provider`, `build_rag_service`). The server, the chat and the ingestion CLI get their dependencies from it; the modules below receive them as arguments.

- **Contracts, not classes:** `VectorStore`, `EmbeddingProvider` and `TextGenerator` (the chat model: `generate` and `stream`, with the model name, temperature, seed and token limit given per call) are `typing.Protocol`s with only the operations the RAG uses. `RagService(config, vector_store_provider, embeddings, generator)` requires all three, and `create_app` and the ingestion `main` no longer fall back to Chroma.
- **Lifecycle:** `ChromaVectorStoreProvider` creates one adapter per strategy, reuses it, and offers `invalidate` and `close`. The default provider, the default embeddings and the default generator are one instance per process (`assistant/storage/factory.py`), so ingestion and search use the same embedding model. No `lru_cache` is left in the storage layer.
- **Index safety:** the manifest records the embedding model and, when known, the vector dimensions. A query whose vector has another size than the stored ones raises `EmbeddingMismatch` with the reindex command, and the HTTP service answers 503 with that message.
- **Functions stay functions:** `retrieve_with_store` and the other pipeline functions are unchanged in style; they take the providers as keyword arguments. Pure logic (RRF, tokenizing, prompts) has no dependencies.

Legacy wrappers (`retrieve`, `answer`, `stream_answer` in `retrieval/pipeline.py`, and `build_index`/`vectorize_chunks` in `assistant/ingest.py`) still resolve the default providers because `evaluation/` calls them. They are the documented exception and go away when the evaluation uses the composition root.

## Alternatives considered
- A DI library (`dependency-injector` and similar): hand-wiring four or five dependencies is shorter and easier to read.
- Keeping the module-level singletons: they hide the lifecycle and block fakes in tests.
- Classes for the whole pipeline now: the BM25 chunk source is still a global (`lru_cache`); the pipeline's shape is decided after it is isolated.

## Consequences
- The server, the chat and the CLI are tested with fakes, without Chroma or Ollama; coverage of `rag/` went from 88% to 94%.
- Switching the embedding model means writing a provider and reindexing; the mismatch check refuses a stale index instead of returning wrong results. Choosing a provider by configuration is not built yet.
- Not done yet: the BM25 chunk source (`_bm25`) is still an `lru_cache` global; the HTTP and CLI paths use the composition root, `evaluation/` does not.

**Evidence:** [composition.py](../../rag/assistant/composition.py), [factory.py](../../rag/assistant/storage/factory.py), [chroma.py](../../rag/assistant/storage/chroma.py), [embeddings.py](../../rag/assistant/storage/embeddings.py), [model.py](../../rag/assistant/generation/model.py), [service.py](../../rag/assistant/retrieval/service.py)
