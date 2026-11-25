# rag — the DentalSafe assistant

The RAG assistant of the fictional DentalSafe clinic and the bench that measures it, copied from the RagLab project (commit `4913779`). Secretaryfy uses it to answer WhatsApp messages.

## What is the same as RagLab

The brochure, the prompt texts (`config/prompts.yaml`, shared by every language), the refusal sentence and the synonyms and stop words (in `config/languages/<language>.yaml` and `config/clinic.yaml`), the chunking strategies, the search experiments, the answer key, the evaluation code, and the reference runs (`evaluation/runs/baseline.json` and the two runs it points to).

Measured right after the copy (run `20261015-233316`, compared with the reference `20261011-191541`): 96.1% (49 of 51), with no question going from right to wrong. The search bench gave `section_hybrid` 44/44.

## What was added

| File | What |
|---|---|
| `server.py` | HTTP service used by Secretaryfy (`/health`, `/answer`, `/retrieve`, `/reindex`) |
| `tests/unit/test_server.py` | Tests of the service, with no model needed |
| `serve` shortcut | In `run.ps1` and `Makefile`, and listed in `tests/unit/test_shortcuts.py` |
| `requirements.txt` | `fastapi`, `uvicorn`, `httpx` |

## Setup

Requires Python 3.14 and [Ollama](https://ollama.com) with `qwen3:8b` and `embeddinggemma`.

```powershell
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest
.\run.ps1 serve
```

`serve` listens on `127.0.0.1:8001`; set `RAG_HOST` and `RAG_PORT` in `rag/.env` to change it. Like the chat, it refuses to start with a missing or out-of-date index and prints the command that fixes it, with one exception described below. A stopped Ollama does not stop it from starting; `/health` reports it instead.

## Startup and /health

With the file source (`KNOWLEDGE_URL` empty) the rule is strict: the server refuses to start when the index is missing, out of date for any reason, or built with another embedding size.

With the Node server as knowledge source (`KNOWLEDGE_URL` set), the owner may edit the knowledge before publishing it, so the knowledge version can differ from the one the index was built from. The server then decides on the reason:

| Situation at startup | Result |
|---|---|
| Index missing | Refuses: `Could not start`, with the ingest command |
| Strategy definition or embedding model changed | Refuses, with the ingest command |
| Knowledge version changed (unpublished edits) | Starts, answering from the last published index; prints one `Warning:` line |
| Knowledge server unreachable, index present | Starts, answering from the last published index; prints one `Warning:` line |

The chat and the ingest command keep the strict rule for both sources.

`GET /health` reports:

- `index.state`: `current`, `stale` or `missing`, computed from the manifest and the knowledge version when the Node server answers. When it does not answer, the state is judged from the manifest alone (no knowledge version is compared).
- `index.built_from`: the knowledge version the index was built from (the manifest `source_hash`), or `null` without an index. The panel compares it with the Node version to show "up to date" or "unpublished". It exists for both sources.
- `knowledge`: `{"source": "file" | "http", "version": ...}` when the knowledge is read. When the Node server cannot be reached: `{"source": "http", "version": null, "reachable": false}`.

The Node server's version is kept for 5 seconds inside the process, so one `/health` call does not fetch the whole document twice. `/health` answers 200 when Ollama is reachable and the index is current, so a Node server that is down does not turn a built index into a 503.

## HTTP service

| Route | Returns |
|---|---|
| `GET /health` | 200 when Ollama is reachable and the index is current, 503 otherwise; the body says which (see [Startup and /health](#startup-and-health)) |
| `POST /answer` `{"question": "..."}` | `answer`, the `chunks` sent to the model (rank, content, score, similarity), `latency_s`, `experiment` |
| `POST /retrieve` `{"question": "..."}` | The same `chunks`, without generating an answer |
| `POST /reindex` | Rebuilds the index of every strategy from the knowledge now served and reports `chunks` per strategy and the knowledge `version`. Bearer token `INTERNAL_TOKEN`; 401 without it, 409 while another reindex runs, 503 when the knowledge server fails, 404 when `INTERNAL_TOKEN` is empty |

An empty question returns 422 without calling the model. A failure talking to Ollama returns 503 with `detail`. The service uses the experiment in the `assistant:` line of `config/experiments.yaml`, the same one the chat and the evaluation use.

## Environment

Read from the environment or from `rag/.env` (see `.env.example`). The defaults apply when a variable is not set.

| Variable | Default | What |
|---|---|---|
| `KNOWLEDGE_URL` | empty | The Node server that owns the knowledge: `GET` this URL with `Authorization: Bearer <INTERNAL_TOKEN>` answers `{"name", "version", "sections": [{"title", "body"}]}`. When set, `KNOWLEDGE_PATH` is not read |
| `CLINIC_URL` | empty | The Node server's clinic identity: `GET` this URL (`/internal/clinic`) with the bearer token answers `{"name", "kind", "language"}`. When set, the name and kind replace the YAML ones on every question (cached a few seconds); when the server cannot be reached, the YAML values are used |
| `INTERNAL_TOKEN` | empty | Bearer token for `KNOWLEDGE_URL`, `CLINIC_URL` and `POST /reindex`. Empty turns `/reindex` off |
| `KNOWLEDGE_PATH` | `data/source/DentalSafe.pdf` | The knowledge file when `KNOWLEDGE_URL` is empty: a PDF, or a Markdown file with one `## Title` per subject |
| `INDEX_DIR` | `data/index` | Where the indexes are written |
| `RAG_HOST` / `RAG_PORT` | `127.0.0.1` / `8001` | Address of the HTTP service |

With `KNOWLEDGE_URL`, `/health` reports `knowledge: {source: "http" | "file", version}`; when the knowledge server is down it reports `reachable: false` instead (see [Startup and /health](#startup-and-health)).

## Cloud models

The chat and the embeddings can run on a cloud model instead of Ollama, through the OpenAI-compatible protocol (`assistant/openai_compat.py`). The default stays Ollama: nothing changes unless `MODEL_PROVIDER` names another provider.

| `MODEL_PROVIDER` | What it uses | Needs |
|---|---|---|
| `ollama` (default) | Local Ollama, the `OLLAMA_*` variables | nothing new |
| `nvidia` | NVIDIA Build preset: `https://integrate.api.nvidia.com/v1`, chat `nvidia/nemotron-3-ultra-550b-a55b`, embeddings `nvidia/nemotron-3.5-embed-8b`, thinking off, 35 requests per minute, 60 s timeout | `MODEL_API_KEY` only |
| `openai-compatible` | Any server that speaks chat/completions and embeddings | `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME`, `MODEL_EMBEDDING_NAME` |

Variables (a `MODEL_*` value overrides the preset; an empty value counts as unset):

| Variable | What |
|---|---|
| `MODEL_PROVIDER` | `ollama`, `openai-compatible` or `nvidia` |
| `MODEL_BASE_URL` | Base URL of the API, without `/chat/completions` |
| `MODEL_API_KEY` | Bearer key. It is never printed: error messages show the variable names only, and the key is masked in server replies |
| `MODEL_NAME` / `MODEL_EMBEDDING_NAME` | Chat model and embedding model |
| `MODEL_EXTRA_BODY` | JSON object merged into every chat request; when set, it replaces the preset's extra body as a whole |
| `MODEL_MAX_TOKENS` | Token cap for a call that sets none |
| `MODEL_MAX_PER_MINUTE` | Client-side limit of HTTP requests per minute (retries included) |
| `MODEL_TIMEOUT_S` | Timeout of each request, 20 s by default |

The settings are read from `rag/.env` first. The repository's root `.env` is read for the `MODEL_*` keys and `NODE_ENV` only, and never overrides a value already set. The root `.env` is shared with the Node server, so if it selects a cloud provider, this RAG uses that provider too.

Module layout of the cloud code (paths under `rag/`):

| Module | What it holds |
|---|---|
| `assistant/model_settings.py` | Pure resolver of the `MODEL_*` settings, the presets, the production guard, the copy of the root `.env` and the index directory name |
| `assistant/config.py` | Constants only: reads `model_settings.py` and re-exports its names for the other modules and the tests |
| `assistant/openai_compat.py` | `OpenAICompatClient`, the base class (HTTP, Bearer key, retry after 429, limiter, counters); `OpenAICompatChat` and `OpenAICompatEmbeddings` inherit it and implement their interface (`TextGenerator`, `EmbeddingProvider`) |
| `assistant/rate_limiter.py` | `RateLimiter`, a token bucket (a burst of 4 calls, refilled at N per minute); one shared instance per provider for the chat and the embeddings |
| `assistant/model_stats.py` | `HasModelStats` protocol and `collect_model_stats`, the sum of the counters of the clients |
| `evaluation/cloud_run.py` | `CloudRun`: the cloud run rules (banner, Ollama preflight, judge off, counters line, invalid rule) |

Rules of the cloud run:

- **Separate index.** A cloud provider's index lives in `data/index-<provider>` (`data/index-nvidia`), so its vectors never overwrite the local index. An explicit `INDEX_DIR` still wins. Build it with the provider selected: `$env:MODEL_PROVIDER = 'nvidia'; .\run.ps1 ingest`.
- **Production guard.** `MODEL_PROVIDER=nvidia` with `NODE_ENV=production` refuses to start: the free NVIDIA Build tier is for development and evaluation only and must not receive real patient conversations (LGPD).
- **What is sent.** Ingest sends the brochure text to the embedding provider. Each answer sends the question, the conversation, and the brochure chunks found for it to the chat model; each question is also embedded. In development, only the clinic's brochure and the invented evaluation questions may go to the provider.
- **Evaluation.** `$env:MODEL_PROVIDER = 'nvidia'; python -m evaluation run` skips the Ollama preflight and prints one `Cloud run` line. The judge metrics stay off, because the judge runs on Ollama. At the end it prints `model calls: N, rate limited: X, failed: Y`. When X or Y is above zero, the run is saved with `invalid` set and the command exits with code 2, the same rule as the Node evaluations.
- **Limits.** There is one rate limiter per provider, shared by the chat and the embeddings clients, so the per-minute limit is the sum of both: one question makes one embeddings call and one chat call. The limit is a token bucket: it holds a burst of 4 calls, which go at once, and refills at N tokens per minute, so the sustained rate never passes N per minute. The burst is capped on purpose, because the provider answers 429 to a flood of 25 to 35 calls at once even when the quota is 40 per minute. A 429 is retried up to 5 attempts in all, with exponential backoff: 2, 4, 8 and 16 seconds, or the retry-after the provider sends when that is longer, each wait capped at 30 seconds. The backoff exists because the free tier's limit is not fixed (it moves with the load and with recent 429s), and every refused attempt counts against the quota, so quick retries 2 seconds apart kept the throttling going; after the fifth 429 the call fails with a clear error. Streaming is not real: the cloud chat gives its whole reply as one piece. `/health` probes Ollama only with the Ollama provider and reports the provider and the model names.
## Commands

`.\run.ps1 help` lists every shortcut (`make <name>` on Linux/macOS). The main ones:

```powershell
.\run.ps1 test          # unit tests, no Ollama
.\run.ps1 validate      # configuration and answer key
.\run.ps1 kb-check      # index sanity
.\run.ps1 experiments   # search bench, seconds
.\run.ps1 eval          # answers on dev, compared with the reference
```

The evaluation manual is in [evaluation/README.md](evaluation/README.md).

## Rules that still apply

- Any change that can affect answers (prompt, synonyms, chunking, search) is measured with `evaluation run --no-judge` and compared with the reference. Read the regressions before the score.
- One or two questions of difference are noise with `qwen3:8b`. Confirm with `--repeat 3` before claiming a change.
- Never tune on the reserved questions; `--holdout` runs once after a round of changes.
- `no_answer` in `config/languages/<language>.yaml` and the `abstention_patterns` of that language's `Locale` in `evaluation/normalize.py` must stay in step.
- `assistant` never imports `evaluation` or `server`.
- The Makefile and `run.ps1` offer the same shortcuts; `tests/unit/test_shortcuts.py` checks it.
