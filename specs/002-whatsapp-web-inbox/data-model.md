# Data Model: Painel web do WhatsApp

São duas tabelas novas no Postgres (`src/db/schema.ts`) e uma migration nova, gerada com `npm run db:generate`. As tabelas `users` e `google_accounts` continuam como estão.

## conversations

Uma linha por número de cliente (FR-002).

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `phone` | text, **unique**, not null | Número sem o sufixo do JID (ex.: `5511999999999`) |
| `name` | text, null | `pushName` mais recente que o cliente enviou |
| `last_message_at` | timestamptz, not null | `sent_at` da mensagem mais recente |
| `last_message_preview` | text, not null | Texto ou rótulo da mídia, cortado em 120 caracteres |
| `unread_count` | integer, not null, default 0 | Soma 1 a cada mensagem com `origin = customer`; volta a 0 em `POST /read` (FR-010) |
| `assistant_paused` | boolean, not null, default false | FR-020 a FR-022b |
| `created_at` | timestamptz, not null, default now | — |

**Índices**: `conversations_last_message_at_idx (last_message_at desc)`.

## messages

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `conversation_id` | uuid FK → conversations.id, `on delete cascade`, not null | — |
| `wa_message_id` | text, **unique**, null | `key.id` da mensagem no WhatsApp. Fica `null` só enquanto um envio está em `sending` (R6) |
| `origin` | enum `message_origin`: `customer` \| `assistant` \| `operator` \| `phone` | Quem escreveu (FR-001) |
| `type` | enum `message_type`: `text` \| `audio` \| `image` \| `video` \| `document` \| `sticker` \| `location` \| `contact` \| `other` | FR-003 |
| `text` | text, null | Corpo da mensagem ou legenda da mídia; `null` para mídia sem legenda |
| `status` | enum `message_status`: `received` \| `sending` \| `sent` \| `failed` | Ver as transições abaixo |
| `error` | text, null | Motivo da falha de envio, mostrado ao operador |
| `sent_at` | timestamptz, not null | R11 |
| `created_at` | timestamptz, not null, default now | — |

**Índices**: `messages_conversation_sent_at_idx (conversation_id, sent_at desc, id desc)`. O `unique (wa_message_id)` aceita vários `null`.

### Origem × situação

| `origin` | Como entra | `status` inicial |
|---|---|---|
| `customer` | Evento `messages.upsert` com `fromMe: false` | `received` |
| `phone` | Evento `fromMe: true` com ID desconhecido e sem `sending` correspondente | `sent` |
| `assistant` | Handler da feature 001: resposta ou mensagem de indisponibilidade | `sending` → `sent` \| `failed` |
| `operator` | `POST /api/conversations/:id/messages` | `sending` → `sent` \| `failed` |

### Transições de `status` (só para `assistant` e `operator`)

```text
sending ──(sendText devolveu key.id)───────────────▶ sent
sending ──(eco fromMe com mesmo texto em ≤ 60 s)───▶ sent       (anexa wa_message_id; R6)
sending ──(sendText falhou)────────────────────────▶ failed     (error preenchido)
failed  ──(operador pede reenvio)──────────────────▶ sending    (mesma linha; FR-013)
```

O reenvio vale só para `origin = operator`. Uma resposta do assistente que falhou fica registrada como `failed` e não é reenviada.

### Rótulos de mídia (prévia e histórico)

| `type` | Rótulo |
|---|---|
| `audio` | 🎤 Áudio |
| `image` | 📷 Imagem |
| `video` | 🎬 Vídeo |
| `document` | 📄 Documento |
| `sticker` | 🖼️ Figurinha |
| `location` | 📍 Localização |
| `contact` | 👤 Contato |
| `other` | Mensagem não suportada |

Quando há legenda, ela aparece depois do rótulo.

## Estado em memória (não persistido)

| Nome | Onde | Conteúdo |
|---|---|---|
| Conexão | `src/modules/whatsapp/instance.ts` | `{ state: "open" \| "connecting" \| "close", number: string \| null, qr: string \| null }` (o QR code em data URL) |
| Tentativas de login | `src/modules/auth/login-limiter.ts` | Por IP: quantidade de falhas e início da janela de 15 min |
| Barramento de eventos | `src/modules/inbox/events.ts` | Assinantes SSE ativos |

## Fluxos que mudam dados

**Mensagem do cliente** (`messages.upsert`, `fromMe: false`):
1. Faz upsert da conversa (por `phone`), atualizando o `name` com o `pushName` recebido.
2. Insere a mensagem com `ON CONFLICT (wa_message_id) DO NOTHING`. Se nada foi inserido, para aqui.
3. Atualiza `last_message_*` e soma 1 em `unread_count`.
4. Publica `message.created` e `conversation.updated`.
5. Se for texto e `assistant_paused = false`, chama o handler da feature 001.

**Resposta do assistente**:
1. Relê `assistant_paused` e, se estiver pausada, descarta a resposta.
2. Insere com `sending` e envia.
3. Atualiza para `sent` ou `failed`, junto com `last_message_*`.
4. Publica `message.created` e `message.updated`.

**Envio do operador**: numa transação, insere com `sending` e grava `assistant_paused = true`. Depois envia, atualiza para `sent` ou `failed` e publica os eventos.

**Abrir a conversa**: `POST /read` zera `unread_count` e publica `conversation.updated`.
