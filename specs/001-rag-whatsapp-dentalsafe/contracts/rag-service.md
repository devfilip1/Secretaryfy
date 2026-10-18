# Contract: serviço RAG (`rag/server.py`)

- **Base URL**: `http://127.0.0.1:8001` (definida por `RAG_HOST`/`RAG_PORT` no `rag/.env`; no Node, pela variável `RAG_SERVICE_URL`).
- **Formato**: JSON UTF-8 nas requisições e nas respostas. Não há autenticação, porque o serviço só escuta em loopback.
- As entidades estão descritas em [data-model.md](../data-model.md).

## Inicialização

`python -m server`, executado de dentro de `rag/` (ou `.\run.ps1 serve` / `make serve`).

| Situação | Saída | Código |
|---|---|---|
| Índice atual e configuração válida | uvicorn escutando na porta | — |
| Índice ausente ou desatualizado | `Could not start: the index of strategy "section" ...; run: python -m assistant.ingest section` | 1 |
| `config/*.yaml` inválido | `Invalid configuration: N problem(s)` + um problema por linha | 2 |

O Ollama fora do ar **não** impede a subida, só aparece no `/health`. Assim o serviço pode subir antes do Ollama.

## `GET /health`

**200** quando `status` é `ready`, **503** quando é `unavailable`. O corpo é o mesmo nos dois casos:

```json
{
  "status": "ready",
  "experiment": "section_hybrid",
  "ollama": { "reachable": true, "url": "http://127.0.0.1:11434" },
  "index": { "strategy": "section", "state": "current", "reason": null }
}
```

## `POST /answer`

Gera a resposta do assistente com a configuração e o prompt da linha `assistant:` (FR-008, FR-010).

**Request**

```json
{ "question": "How much are braces?" }
```

`question` é obrigatória, do tipo string, e precisa ter pelo menos um caractere que não seja espaço depois do `strip`.

**200**

```json
{
  "answer": "Braces cost $180–$450 (Initial cost) and $35–$90 (Monthly). Would you like to schedule an assessment?",
  "chunks": [
    { "rank": 1, "content": "Orthodontic Braces — ...", "score": 0.0328, "similarity": 0.71 }
  ],
  "latency_s": 0.74,
  "experiment": "section_hybrid"
}
```

**422**: `question` ausente, vazia ou só com espaços. O modelo não é chamado (FR-012). O corpo é o padrão do FastAPI (`{"detail": [...]}`).

**503**: falha ao falar com o Ollama durante a busca ou a geração (conexão recusada, modelo ausente, erro do Ollama). Corpo: `{"detail": "<mensagem>"}`. O erro também vai para o log do serviço.

## `POST /retrieve`

Só a busca, sem gerar resposta (FR-009). Fica pronta para virar ferramenta do agente de agendamentos.

**Request**: igual ao de `/answer`.

**200**

```json
{
  "chunks": [
    { "rank": 1, "content": "Orthodontic Braces — ...", "score": 0.0328, "similarity": 0.71 }
  ],
  "latency_s": 0.08,
  "experiment": "section_hybrid"
}
```

`chunks` é `retrieval.fused`, os mesmos trechos que iriam para o modelo. A lista pode vir vazia quando o limiar está ativo e corta tudo.

**422** e **503**: como em `/answer`.

## O que o Node espera (`src/modules/rag/client.ts`)

- Só chama `POST /answer`.
- Considera falha qualquer um destes casos: erro de rede, `AbortSignal.timeout(RAG_TIMEOUT_MS)`, status diferente de 2xx, ou corpo sem `answer` em string. Todos viram `RagUnavailableError`.
- Usa `answer` sem alteração como texto da mensagem do WhatsApp.
