# Data Model: Proteção do número contra banimento (anti-ban)

Migration `drizzle/0004_antiban.sql`, gerada pelo Drizzle a partir de `src/db/schema.ts`.

## Mudanças em tabelas existentes

### `messages`

- **Enum `message_status`:** ganha o valor `blocked`. É uma resposta que a proteção não enviou; `error` guarda o código do motivo (tabela abaixo). Nenhuma linha usa o valor dentro da migration, então ela pode adicioná-lo e criar as tabelas na mesma execução.
- **Índice novo `messages_outgoing_sent_at_idx`:** sobre `(sent_at DESC)`, com a condição `origin IN ('assistant','operator') AND status = 'sent'`. Sustenta a semente da janela de envios e a contagem de 24 h (research.md R2).

| Código (`error`) | Mostrado no painel | Requisito |
|---|---|---|
| `outside_window` | Cliente não escreve há mais de 24 h | FR-001 |
| `rate_limited` | Ficou tempo demais na fila | FR-012 |
| `daily_conversations` | Limite diário de conversas atingido | FR-011 |
| `unanswered` | Muitas mensagens seguidas sem resposta do cliente | FR-013 |
| `loop` | Possível conversa com outro robô | FR-014 |
| `duplicate` | Texto repetido | FR-016, FR-017 |
| `opted_out` | O cliente pediu para não receber mensagens | FR-020 |
| `paused` | Envios automáticos pausados pela proteção | FR-027 |
| `restart` | Servidor reiniciado antes do envio | edge case |
| `superseded` | O operador respondeu antes | edge case |

### `conversations`

Nenhuma coluna nova. O destaque e a pausa reaproveitam `needs_attention` e `assistant_paused` (feature 003). Se o cliente pediu para sair, a informação vem de `contact_preferences` pelo `phone`, e o presenter a expõe como `optedOut`.

## Tabelas novas

### `contact_preferences`

A preferência do cliente, ligada ao **telefone** e não à conversa: ela sobrevive à limpeza das conversas ao desconectar.

| Coluna | Tipo | Regra |
|---|---|---|
| `phone` | `text` PK | Formato `5511999999999`, igual a `conversations.phone` |
| `opted_out_at` | `timestamptz` null | Preenchido = não recebe mensagens do assistente |
| `updated_at` | `timestamptz` not null default now() | |

**Transições** de `opted_out_at`:
- `null → now()`: o cliente mandou uma palavra de saída.
- `→ null`: o cliente mandou uma palavra de volta, ou o operador reativou pelo painel.

### `connected_numbers`

Os números já conectados neste Secretaryfy. Decide o aquecimento.

| Coluna | Tipo | Regra |
|---|---|---|
| `number` | `text` PK | Número do dono da instância (`5511…`) |
| `first_connected_at` | `timestamptz` not null default now() | Início do aquecimento |
| `last_connected_at` | `timestamptz` not null default now() | Atualizado a cada conexão |

O aquecimento vale enquanto `now < first_connected_at + ANTIBAN_WARMUP_DAYS`.

### `protection_state`

Uma linha só (`id = 1`), como em `calendar_connection`.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `smallint` PK default 1 | CHECK `id = 1` |
| `paused_until` | `timestamptz` null | Preenchido e no futuro = freio ativo |
| `reason` | `text` null | `send_failures` ou `connection_drops` |
| `updated_at` | `timestamptz` not null default now() | |

**Estados derivados**, mostrados no painel (FR-028):

```
paused   se paused_until > now
warmup   senão, se o número conectado está no aquecimento
normal   nos demais casos
```

## Estado em memória (não persistido)

| Item | Onde | Por que não vai para o banco |
|---|---|---|
| Fila de respostas | `antiban/queue.ts` | Num reinício deve ser descartada, não reenviada (R2) |
| Temporizador de silêncio por conversa | `antiban/debounce.ts` | Só vale por alguns segundos |
| Horários dos envios da última hora | `antiban/gate.ts` | Semeados do banco na primeira vaga pedida (research.md R2) |
| Horários das falhas e das quedas de conexão | `antiban/breaker.ts` | Janelas de 10 e 30 min; um reinício já é uma pausa |
| Horários dos pedidos de QR | `whatsapp/instance.ts` | Idem, janela de 10 min |

Um item da fila tem `conversationId`, `phone`, `messageId` (a linha em `sending` já gravada), `text`, `origin`, `enqueuedAt` e `expiresAt` (`enqueuedAt + ANTIBAN_QUEUE_MAX_AGE_MS`).

## Ciclo de vida de uma resposta do assistente

```
mensagem do cliente
  → debounce (4 s de silêncio)
  → pedido de saída? → grava preferência, confirmação única, fim
  → cliente optou por sair? → nada (a mensagem já está no painel), fim
  → roteador decide o texto
  → portão (antes da fila): janela 24 h, saída, insistência, laço, repetição, conversas/dia, freio
        recusa → status blocked + motivo (e destaque, se for loop, daily_conversations ou paused)
  → links removidos se for o caso
  → grava "sending" e entra na fila
  → trabalhador: espera vaga no limite por minuto/hora + intervalo aleatório
        expirou na fila → blocked rate_limited + destaque
        conversa pausada ou operador respondeu → blocked superseded
        freio disparou → blocked paused
  → marca como lidas → sendText com delay ("digitando…") → sent | failed
  → failed conta para o freio
```

As mensagens do operador fazem o mesmo caminho a partir de "portão". O portão, porém, só **avisa** (`409`, com riscos) em vez de recusar, e as regras de laço, insistência e repetição não valem para ele.

## Configuração

Novas variáveis em `src/config/env.ts`, todas opcionais com padrão (FR-030):

| Variável | Padrão | Requisito |
|---|---|---|
| `ANTIBAN_READ_MIN_MS` / `ANTIBAN_READ_MAX_MS` | 2000 / 8000 | FR-005a |
| `ANTIBAN_THINK_MIN_MS` / `ANTIBAN_THINK_MAX_MS` | 1000 / 3000 | FR-005b |
| `ANTIBAN_TYPING_MIN_MS` / `ANTIBAN_TYPING_MAX_MS` | 2000 / 12000 | FR-006 |
| `ANTIBAN_DEBOUNCE_MS` | 4000 | FR-007 |
| `ANTIBAN_PER_MINUTE` / `ANTIBAN_PER_HOUR` | 8 / 200 | FR-009 |
| `ANTIBAN_GAP_MIN_MS` / `ANTIBAN_GAP_MAX_MS` | 2000 / 6000 | FR-010 |
| `ANTIBAN_CONVERSATIONS_PER_DAY` | 150 | FR-011 |
| `ANTIBAN_QUEUE_MAX_AGE_MS` | 300000 | FR-012 |
| `ANTIBAN_MAX_UNANSWERED` | 3 | FR-013 |
| `ANTIBAN_LOOP_FAST_REPLY_MS` / `ANTIBAN_LOOP_FAST_REPLIES` | 3000 / 5 | FR-014 |
| `ANTIBAN_LOOP_BURST` / `ANTIBAN_LOOP_BURST_WINDOW_MS` | 20 / 600000 | FR-014 |
| `ANTIBAN_DUPLICATE_WINDOW_MS` | 1800000 | FR-016, FR-017 |
| `ANTIBAN_ALLOWED_LINK_DOMAINS` | vazio | FR-018 |
| `ANTIBAN_WARMUP_DAYS` | 14 | FR-023 |
| `ANTIBAN_WARMUP_CONVERSATIONS_PER_DAY` / `ANTIBAN_WARMUP_PER_MINUTE` | 30 / 4 | FR-024 |
| `ANTIBAN_RETRY_MIN_INTERVAL_MS` | 30000 | FR-025 |
| `ANTIBAN_BREAKER_FAILURES` / `ANTIBAN_BREAKER_FAILURE_WINDOW_MS` | 5 / 600000 | FR-026 |
| `ANTIBAN_BREAKER_DROPS` / `ANTIBAN_BREAKER_DROP_WINDOW_MS` | 3 / 1800000 | FR-026 |
| `ANTIBAN_BREAKER_PAUSE_MS` | 1800000 | FR-026 |
| `ANTIBAN_QR_ATTEMPTS` / `ANTIBAN_QR_WINDOW_MS` | 5 / 600000 | FR-029 |

A validação recusa mínimo maior que máximo, e limites de aquecimento maiores que os normais.
