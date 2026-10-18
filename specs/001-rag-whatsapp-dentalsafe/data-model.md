# Data Model: Respostas da DentalSafe pelo WhatsApp com o RAG do RagLab

Esta feature não cria tabelas nem migrations. As entidades abaixo existem só em memória ou trafegam entre o Node e o serviço RAG. Os formatos de transporte estão em [contracts/rag-service.md](contracts/rag-service.md).

## IncomingMessage (Node, `src/modules/whatsapp/evolution.ts`)

É a mensagem de texto recebida pelo webhook. Já existe e ganha o campo `id`.

| Campo | Tipo | Origem no evento | Regra |
|---|---|---|---|
| `id` | string | `data.key.id` | **Novo.** Obrigatório; sem ele, a mensagem é ignorada. |
| `phone` | string | `data.key.remoteJid` antes do `@` | Só JIDs `@s.whatsapp.net` (exclui grupos). |
| `pushName` | string \| undefined | `data.pushName` | Opcional. |
| `text` | string | `message.conversation` ou `message.extendedTextMessage.text` | **Nova regra:** se `text.trim()` for vazio, a mensagem é ignorada. |

Continua ignorando: eventos diferentes de `messages.upsert`, `fromMe: true` e mensagens sem texto (áudio, imagem, figurinha).

## SeenMessages (Node, `src/modules/whatsapp/dedupe.ts`)

Registro em memória dos IDs de mensagem já processados.

| Campo | Tipo | Regra |
|---|---|---|
| chave | `IncomingMessage.id` | — |
| valor | instante de expiração (ms) | `agora + 10 min` |

- **Capacidade**: no máximo 1000 entradas. Quando passa disso, remove as mais antigas, pela ordem de inserção do `Map`.
- **Operação**: `markSeen(id): boolean` devolve `true` na primeira vez que vê o ID dentro da validade e `false` nas seguintes.
- **Ciclo de vida**: é zerado quando o processo reinicia (aceito na spec).

## RagAnswer (resposta do serviço, consumida pelo Node)

| Campo | Tipo | Regra |
|---|---|---|
| `answer` | string | Texto enviado ao cliente sem alteração. |
| `chunks` | `RetrievedChunk[]` | Os trechos que foram para o modelo (`retrieval.fused`), em ordem de rank. |
| `latency_s` | number | Tempo de `answer()` em segundos. |
| `experiment` | string | Nome do experimento usado (ex.: `section_hybrid`). |

## RetrievedChunk (serviço RAG)

Espelha o `RetrievedChunk` de `rag/assistant/pipeline.py`.

| Campo | Tipo | Regra |
|---|---|---|
| `rank` | integer ≥ 1 | Posição depois da fusão. |
| `content` | string | Texto do trecho do folheto. |
| `score` | number \| null | Pontuação de fusão (RRF). |
| `similarity` | number \| null | Cosseno entre a pergunta e o trecho, de 0 a 1. |

## AssistantHealth (serviço RAG)

| Campo | Tipo | Regra |
|---|---|---|
| `status` | `"ready"` \| `"unavailable"` | `ready` só quando o Ollama está acessível **e** o índice está `current`. |
| `experiment` | string | Experimento da linha `assistant:` de `config/experiments.yaml`. |
| `ollama.reachable` | boolean | `GET /api/tags` respondeu 2xx em até 2 s. |
| `ollama.url` | string | `OLLAMA_BASE_URL` em uso. |
| `index.strategy` | string | Estratégia do experimento (ex.: `section`). |
| `index.state` | `"current"` \| `"stale"` \| `"missing"` | Calculado por `index_state()`. |
| `index.reason` | string \| null | Mensagem com o comando que resolve, ou `null`. |

## Fluxo de uma mensagem (estados)

```text
recebida ──(token inválido)──────────────────────────────▶ 401, fim
   │
   ├─(não é texto / vazia / fromMe / grupo / sem id)─────▶ 200, ignorada
   │
   ├─(id já visto)───────────────────────────────────────▶ 200, ignorada
   │
   ▼
200 enviado à Evolution API ──▶ em segundo plano: pergunta ao serviço RAG
                                   │
                                   ├─(2xx com answer)──────────▶ envia answer ao cliente
                                   │
                                   └─(erro/timeout/não-2xx)────▶ envia mensagem de indisponibilidade
                                                                  + log error {phone, motivo}

falha ao enviar pelo WhatsApp em qualquer ramo ──▶ log error, sem nova tentativa
```
