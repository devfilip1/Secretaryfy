# Integrations

| Service | What for | How | Config |
|---|---|---|---|
| Evolution API v2.3.7 | WhatsApp connection: receive, send, read receipts, QR code | REST calls with an API key; webhook to `/webhooks/evolution` | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_TOKEN`, `WEBHOOK_BASE_URL` |
| Google Calendar API | Free/busy, create, move, rename and delete events | `googleapis` with OAuth 2 (offline refresh token) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL`, `PANEL_URL` |
| Chat model: Ollama (`qwen3:8b`, default) or any OpenAI-compatible API | Interpreting patient messages and rewording replies | `POST /api/chat` (Ollama) or `POST /chat/completions` with a JSON Schema `response_format` | `MODEL_PROVIDER` and, per provider, the variables in [Model provider](#model-provider) |
| RAG service (`rag/`) | Answering questions from the brochure | `POST /answer` on the local Python service | `RAG_SERVICE_URL`, `RAG_TIMEOUT_MS` |

Values never go in the docs; see [development](development.md#environment-variables) for what each variable is and where to get it.

## Evolution API

Runs in Docker ([docker-compose.yml](../docker-compose.yml)) with Redis, storing its data in the `evolution_api` schema of the same Postgres. It uses the WhatsApp Web protocol (Baileys), so the clinic's number is paired by QR code, like WhatsApp Web ([ADR 0004](decisions/0004-evolution-api-unofficial-whatsapp.md)).

- **Calls made** ([evolution.ts](../src/modules/whatsapp/evolution.ts), [instance.ts](../src/modules/whatsapp/instance.ts)): `POST /message/sendText/{instance}` (with a `delay` that shows "typing…"), `POST /chat/markMessageAsRead/{instance}`, `POST /instance/create`, `POST /webhook/set/{instance}`, `GET /instance/connect/{instance}` (QR), `GET /instance/connectionState/{instance}`, `GET /instance/fetchInstances`, `DELETE /instance/logout/{instance}`.
- **Setup is automatic.** When the operator asks for a QR code (`POST /api/connection/qr`), the server creates the instance if it doesn't exist (`WHATSAPP-BAILEYS` integration) and points its webhook to `${WEBHOOK_BASE_URL}/webhooks/evolution?token=${EVOLUTION_WEBHOOK_TOKEN}`. Because the Evolution API runs inside Docker, `WEBHOOK_BASE_URL` is `http://host.docker.internal:3000`, not `PUBLIC_URL`.
- **Webhook events:** `messages.upsert` (incoming and messages sent from the phone), `send.message` (echo of what the server sent), `connection.update`, `qrcode.updated`. Parsing in [evolution.ts](../src/modules/whatsapp/evolution.ts); the 200 is sent before any processing.
- **Polling:** while a panel is open, the connection state is also polled every 10 s, because some state changes don't arrive as events.
- **If it's down:** the server still starts; sends fail (counted by the breaker) and the panel shows the number disconnected. Operator sends return 502.
- **Security:** keep the image from the official source and up to date. Third-party "anti-ban" builds have been caught stealing sessions.

## Google Calendar

One Google account and one calendar per installation, chosen in the panel ([google/](../src/modules/google)).

- **OAuth:** `POST /api/calendar/connect` builds the consent URL with `access_type=offline`, `prompt=consent` and a signed `state`. Google redirects to `${PUBLIC_URL}/auth/google/callback`, which stores the refresh token encrypted and returns to `${PANEL_URL}`.
- **Scopes** (the narrowest that work): `calendar.events`, `calendar.calendarlist.readonly`, `calendar.events.freebusy`, plus `openid` and `email`. If the operator unticks one, the panel reports the missing scope.
- **Calls** ([calendar.ts](../src/modules/google/calendar.ts), behind the `CalendarGateway` interface in [gateway.ts](../src/modules/google/gateway.ts)): `calendarList.list` (writer access), `freebusy.query`, `events.insert`, `events.get`, `events.patch` (move, rename), `events.delete`. All with `sendUpdates: "none"`; nobody gets Google emails.
- **Source of truth:** the local copy is reconciled with `events.get` before use ([ADR 0005](decisions/0005-google-calendar-source-of-truth.md)). A 404/410 means the event was deleted in Google.
- **Failures:** network or API errors become `CalendarUnavailable`. The assistant tells the patient it can't book right now, and the panel gets 502 `calendar_unavailable`. A revoked token sets the connection to `needs_reauth` and the panel asks to reconnect.
- **One-time Google Cloud setup:** enable the Calendar API; add the redirect URI; add the scopes and the clinic's Gmail as a test user on the consent screen. Steps in [development](development.md#google-calendar-setup).
- **Tests** use [fake-calendar.ts](../src/test/fake-calendar.ts), an in-memory implementation of the same interface.
- **Offline mode:** `CALENDAR_MODE=fake` uses that same in-memory calendar in development, with no OAuth and nothing sent to Google. See [development](development.md#offline-calendar).

## Ollama

Local model server. Secretaryfy calls it for interpretation ([ollama.ts](../src/modules/scheduling/ollama.ts)), and the RAG service calls it for embeddings (`embeddinggemma`), query rewriting and answers (`qwen3:8b`).

- Interpreter call: `POST {OLLAMA_URL}/api/chat` with `stream: false`, `format: <JSON Schema>`, `temperature: 0`, `keep_alive: "30m"`, and a 20 s timeout. Non-JSON output or any error raises `InterpreterUnavailable`.
- The model in use is `qwen3:8b`: 8.2B parameters, Q4_K_M quantization, 40k context, with its thinking turned off (`think: false` in this client, `OLLAMA_THINKING` in the RAG). One chat model serves the RAG and the interpreter, so the GPU holds it and the embedding model together. `AGENT_MODEL` switches it; `scripts/eval-scheduling.ts` compares models: `qwen3:8b` and `llama3` both pass its 23 scenarios.
- Most messages never reach the model: the interpreter's rules handle numbers, yes/no, dates, times and names; the model reads the services ([message pipeline](message-pipeline.md#6a-interpret)).

## Model provider

The interpreter and the reply rewriter ([humanize.ts](../src/modules/scheduling/humanize.ts)) call one chat model through [model-client.ts](../src/modules/scheduling/model-client.ts), built by `createModelClientFromEnv`. `MODEL_PROVIDER` chooses where it runs:

| `MODEL_PROVIDER` | Where the model runs | Variables |
|---|---|---|
| `ollama` (default) | Local Ollama: `POST {OLLAMA_URL}/api/chat` | `OLLAMA_URL`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS` |
| `openai-compatible` | Any server that speaks the OpenAI protocol: `POST {MODEL_BASE_URL}/chat/completions` (the name is the protocol, not a company; it also fits Azure, vLLM and others) | `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME` (all three required), optional `MODEL_EXTRA_BODY`, `MODEL_MAX_TOKENS`, `MODEL_MAX_PER_MINUTE` |
| `nvidia` | Preset of the [NVIDIA Build](https://build.nvidia.com) API, over the `openai-compatible` protocol. For development and evaluation only | Only `MODEL_API_KEY` is required. Preset defaults: `MODEL_BASE_URL=https://integrate.api.nvidia.com/v1`, `MODEL_NAME=nvidia/nemotron-3-ultra-550b-a55b`, `MODEL_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}`, `MODEL_MAX_PER_MINUTE=35`, `AGENT_TIMEOUT_MS=60000` |

With `ollama`, `MODEL_NAME`, when set, overrides `AGENT_MODEL`.

**Presets.** A preset is a table of default values for a known provider (`PROVIDER_PRESETS` in [model-client.ts](../src/modules/scheduling/model-client.ts)). Every `MODEL_*` variable and `AGENT_TIMEOUT_MS`, when set, overrides the preset value; `MODEL_EXTRA_BODY`, when set, replaces the preset extra body as a whole. The code default stays `ollama` on purpose: a missing configuration must never silently send patients' messages to a cloud.

The boot check in [env.ts](../src/config/env.ts) stops the server when `MODEL_PROVIDER=openai-compatible` lacks one of the three required variables, or `MODEL_PROVIDER=nvidia` lacks `MODEL_API_KEY`; the error names the variables only, never their values. It also refuses `MODEL_PROVIDER=nvidia` when `NODE_ENV=production`: the free NVIDIA Build tier is for development and evaluation only and must not receive real patient conversations (LGPD).

- **Structured output:** the `openai-compatible` and `nvidia` providers send the same JSON Schema the Ollama client sends as `format`, under `response_format: { type: "json_schema", ... }`, so the interpreter gets the same shape from either provider. Output that is not JSON is treated as "did not understand", as with Ollama. Every schema is strict-compatible: all properties are in `required` (an absent value is `null`) and every object has `additionalProperties: false`, so any provider, including Azure OpenAI strict mode, accepts it (checked by `schema-strict.test.ts`).
- **Rate limits (429):** a 429 response is retried, up to 3 attempts in total, waiting the `retry-after` header (at most 30 s; 2 s without it). If it still fails, the call raises `InterpreterUnavailable`, as any other failure, and the patient gets the fixed text.
- **Client-side limit:** `MODEL_MAX_PER_MINUTE` (e.g. `35` for a limit of 40 per minute) spaces the HTTP attempts at least `60000 / MODEL_MAX_PER_MINUTE` ms apart, retries after a 429 included; calls wait in line. Unset, nothing waits. Set it below the provider's limit so the 429 does not happen at all.
- **Reasoning models:** a model that thinks before answering can put its reasoning in the output and break the JSON. Turn the thinking off with `MODEL_EXTRA_BODY`, for example `{"chat_template_kwargs":{"enable_thinking":false}}`, which is merged into each request body. `MODEL_MAX_TOKENS` caps the answer length.
- **Privacy (LGPD):** a cloud provider receives the text of patients' messages, which is health-related personal data. The free NVIDIA Build tier is for development and evaluation only: use invented phrases, never real conversations. `MODEL_PROVIDER=nvidia` is refused in production. Keep `MODEL_PROVIDER=ollama` for real clinic data unless the clinic has a processing agreement with the provider.
- **Scripts:** `scripts/eval-scheduling.ts` and `scripts/eval-interpret.ts` use the same client, so the provider they measure is the one in `.env`. Each run ends with `chamadas ao modelo: N, limite 429: X, falhas de infraestrutura: Y` (from the client's `stats()`); when X or Y is above 0 the run is invalid: it prints `RESULTADO INVALIDO` and exits with code 2. Repeat it, since those numbers say nothing about the model.

## Knowledge endpoint

The Node server serves the clinic's brochure at `GET /internal/knowledge`, authenticated by `INTERNAL_TOKEN` (bearer token, see [api.md](api.md#internal-routes)). The brochure lives in the `knowledge_sections` table ([data-model.md](data-model.md#knowledge_sections)); the clinic section's HORÁRIO lines are not stored: they are generated from the scheduling rules on every read (BR-KNO-02). Load the brochure once from a Markdown file with `npx tsx --env-file=.env scripts/import-knowledge.ts <file.md>`, which replaces the whole table. The RAG reads this endpoint when `KNOWLEDGE_URL` is set: the Node side is ready, but `rag/` still reads its file (`KNOWLEDGE_PATH`) and does not call the endpoint yet, so the two are not connected until the RAG side changes.

### Publishing the knowledge

The panel edits the sections (see [api.md](api.md#knowledge--panel-knowledgets)) and publishes them when the operator asks. `POST /api/knowledge/publish` calls the RAG's `POST /reindex` with `INTERNAL_TOKEN` as the bearer (`RAG_SERVICE_URL` is the RAG address; [admin.ts](../src/modules/rag/admin.ts)). The RAG reads the sections from `GET /internal/knowledge` and rebuilds the index; the request sends nothing. Without `INTERNAL_TOKEN` the RAG refuses the reindex and publishing answers 502.

The panel compares the version of the current sections with the one the RAG reports on `GET /health` (`knowledge.version`, read only while the RAG's `index.state` is `current`, since the source version is not the indexed one otherwise): equal is `upToDate`, different is `unpublished`, and an unreachable RAG is `unavailable`. The RAG answers `/health` with 503 when it is not ready, and the panel reads that body too. A second publish while the RAG is indexing gets 409.

## Clinic identity endpoint

The RAG reads the clinic's name and kind from `GET /internal/clinic` when `CLINIC_URL` is set (same bearer token, `INTERNAL_TOKEN`; see [api.md](api.md#internal-routes)). The panel edits them in `clinic_settings`, so a rename reaches the next question within a few seconds, without a restart. The reply is `{name, kind, language, treatments}`; `treatments` carries the "Other names patients use" of each treatment (field `otherNames` in the panel), and the RAG adds them to its query synonyms. The prompt's example treatment and rule 5 (treatments with several named prices or durations) are also built from `treatments`, so the clinic needs no YAML for them. Measured with the real model (qwen3:8b, pt, no YAML synonyms): dev 88.2% vs 92.2%, holdout 95.2% vs 95.2%, clean 89.1% vs 85.9%, the same 122 of 136 as the YAML. The RAG loads the language pack (`config/languages/<language>.yaml`) of the `language` it receives, so a change in the Clinic tab switches the prompt, the refusal phrases and the word index; a language with no pack falls back to the YAML language with a warning, and the YAML `query_synonyms` apply only to the YAML language (ADR 0016). When the Node server cannot be reached, the YAML name and kind are used.

## RAG service

The DentalSafe assistant from the RagLab project, copied into [`rag/`](../rag) and wrapped in a small FastAPI server ([ADR 0001](decisions/0001-reuse-raglab-as-separate-service.md)).

- **Contract:** `POST /answer {question, history[≤20]}` → `{answer, chunks, latency_s, experiment}`; `GET /health` → 200 only when Ollama answers and the index is current; `POST /retrieve` for debugging. See [rag/README.md](../rag/README.md).
- **Pipeline:** standalone-question rewrite from the history → hybrid search (`section_hybrid`: Chroma vectors + BM25, reciprocal rank fusion, section-sized chunks of `rag/data/source/DentalSafe.pdf`) → `llama3` answers only from the retrieved chunks or says "I don't have that information right now."
- **Quality:** measured with RagLab's bench right after the copy: 96.1% (49 of 51) on the answer key, with no regression against the reference run.
- **Client:** [rag/client.ts](../src/modules/rag/client.ts) sends the last 6 turns with a 30 s timeout. Any failure becomes the "unavailable" message to the patient; a late answer is never sent because the request is aborted.
- **Rule from RagLab:** any change to the prompt, synonyms, chunking or search must be measured with the evaluation bench before it's kept ([rag/README.md](../rag/README.md#rules-that-still-apply)).
