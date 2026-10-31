# 0009 · One composition root for the RAG service, with injected providers

**Status:** Accepted · **Date:** 2026-10-30

## Context
`rag/` started as a copy of RagLab. Its modules built their own dependencies: a global `EMBEDDINGS` created at import, a `get_vector_store` behind `lru_cache`, and entry points (server, chat, ingestion CLI) that each picked Chroma on their own. Tests could not swap the vector store or the embedding model without Chroma and Ollama running, ingestion and search shared the embedding model only by accident, and nothing stopped a search from comparing vectors of different sizes. The planned cloud work ([architecture](../architecture.md#planned-cloud-ready-dependency-composition)) needs providers to be replaceable.

## Decision
Each process has one composition root: [`rag/assistant/composition.py`](../../rag/assistant/composition.py). It is the only place that chooses concrete backends (`build_vector_store_provider`, `build_embeddings_provider`, `build_rag_service`). The server, the chat and the ingestion CLI get their dependencies from it; the modules below receive them as arguments.

- **Contracts, not classes:** `VectorStore`, `EmbeddingProvider`, `TextGenerator` (the chat model: `generate` and `stream`, with the model name, temperature, seed and token limit given per call) and `ChunkSource` (the chunk texts of a strategy and the version of that set) are `typing.Protocol`s with only the operations the RAG uses. Their implementations travel together in `RagDeps` (a frozen dataclass: `vector_store_provider`, `embeddings`, `generator`, `lexical`). `RagService(config, deps)` requires every field, `create_app` takes a service or `deps`, and neither it nor the ingestion `main` falls back to Chroma.
- **Lifecycle:** `ChromaVectorStoreProvider` creates one adapter per strategy, reuses it, and offers `invalidate` and `close`. The default provider, the default embeddings and the default generator are one instance per process (`assistant/storage/factory.py`), so ingestion and search use the same embedding model. No `lru_cache` is left in the storage or retrieval layers.
- **Caches follow the index version:** the BM25 index (`LexicalIndex`) and the Chroma adapters are rebuilt when the version of the index changes (the modification time of `manifest.json`, written last by the ingestion). An ingestion run by another process is used on the next question without restarting the server. If `chunks.json` holds a chunk the vector store does not, the search raises `IndexInconsistent` with the reindex command instead of a `KeyError`.
- **Index safety:** the manifest records the embedding model and, when known, the vector dimensions. A query whose vector has another size than the stored ones raises `EmbeddingMismatch` with the reindex command, and the HTTP service answers 503 with that message.
- **Functions stay functions:** `retrieve(question, config, deps)`, `answer(question, config, history, deps)` and `stream_answer(question, config, deps)` take the one `deps` object; the helpers below them take only the piece they use. Pure logic (RRF, tokenizing, prompts) has no dependencies. Callers never pass `deps`: they use `RagService`, which holds it.

The evaluation bench builds its services through the composition root too (`build_rag_service(config)`), so no legacy wrapper that resolves defaults remains. The one leftover is `ChromaVectorStoreProvider`, which falls back to the process default embeddings when none are injected.

## Alternatives considered
- A DI library (`dependency-injector` and similar): hand-wiring four or five dependencies is shorter and easier to read.
- Keeping the module-level singletons: they hide the lifecycle and block fakes in tests.
- Classes (`Retriever`, `Answerer`) that hold the dependencies: same result with more ceremony; a dependency object plus functions was chosen, and switching later is mechanical because the evaluation bench pins the answers.

## Consequences
- The server, the chat and the CLI are tested with fakes, without Chroma or Ollama; coverage of `rag/` went from 88% to 94%.
- Switching the embedding model means writing a provider and reindexing; the mismatch check refuses a stale index instead of returning wrong results. Choosing a provider by configuration is not built yet.
- The version is a file modification time, which is fine on NTFS and ext4 but too coarse on file systems with 2 s granularity.

**Evidence:** [composition.py](../../rag/assistant/composition.py), [factory.py](../../rag/assistant/storage/factory.py), [chroma.py](../../rag/assistant/storage/chroma.py), [embeddings.py](../../rag/assistant/storage/embeddings.py), [model.py](../../rag/assistant/generation/model.py), [chunks.py](../../rag/assistant/retrieval/chunks.py), [lexical.py](../../rag/assistant/retrieval/lexical.py), [service.py](../../rag/assistant/retrieval/service.py)
