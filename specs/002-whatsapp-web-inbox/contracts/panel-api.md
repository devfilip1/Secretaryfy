# Contract: API do painel (`/api/*`)

- **Origem**: a mesma do painel. Em desenvolvimento, o Vite (`:5173`) repassa para o Fastify (`:3000`).
- **Formato**: JSON UTF-8. Os `POST` com corpo exigem `Content-Type: application/json`; sem ele, a resposta é 415.
- **Autenticação**: o cookie `sf_session`. Sem cookie válido, toda rota abaixo, exceto `/api/session`, responde **401** `{"error":"unauthenticated"}`.
- **Painel desligado**: sem `OPERATOR_PASSWORD` configurada, todas as rotas respondem **503** `{"error":"panel_disabled"}`.
- **Datas**: em ISO 8601 UTC.
- **Entidades**: ver [data-model.md](../data-model.md).

## Sessão

### `POST /api/session`

Faz o login.

- **Corpo**: `{ "password": "..." }`.
- **204**: grava o cookie `sf_session` (HttpOnly, SameSite=Strict, 12 h).
- **401**: `{"error":"invalid_credentials"}`, sempre a mesma mensagem (FR-024).
- **429**: `{"error":"too_many_attempts","retry_after_s":N}`, depois de 5 falhas do mesmo IP em 15 min.

### `GET /api/session`

- **200**: `{ "authenticated": true }`.
- **401**: sem sessão.

### `DELETE /api/session`

- **204**: apaga o cookie (FR-025).

## Conexão do WhatsApp

### `GET /api/connection`

```json
{ "state": "open", "number": "5511988887777", "qr": null }
```

- `state` é `open`, `connecting` ou `close`.
- `qr` só vem preenchido (data URL PNG) quando `state` não é `open` e já existe um QR code gerado.

### `POST /api/connection/qr`

Prepara a conexão e devolve um QR code novo.

- **O que faz**: garante que a instância existe, configura o webhook (FR-019) e pede o QR code à Evolution API.
- **200**: `{ "state": "connecting", "number": null, "qr": "data:image/png;base64,..." }`.
- **409**: `{"error":"already_connected"}`, quando o número já está conectado.
- **502**: `{"error":"evolution_unavailable","detail":"..."}`, quando a Evolution API não responde.

### `DELETE /api/connection`

Desconecta o número (FR-018).

- **204**: desconectado. O estado passa a `close`, e isso chega ao painel pelo SSE.
- **502**: como acima.

## Conversas

### `GET /api/conversations?q=`

- **`q`** (opcional): filtra por nome ou número.
- **200**: até 100 conversas, a mais recente primeiro.

```json
{
  "conversations": [
    {
      "id": "uuid",
      "phone": "5511999999999",
      "name": "Maria",
      "lastMessageAt": "2026-10-16T13:05:00.000Z",
      "lastMessagePreview": "How much are braces?",
      "unreadCount": 2,
      "assistantPaused": false
    }
  ]
}
```

### `GET /api/conversations/:id/messages?before=<messageId>&limit=50`

- **`limit`**: padrão 50, máximo 100.
- **`before`**: devolve as mensagens mais antigas que a indicada.
- **200**: as mensagens vêm em ordem cronológica (a mais antiga primeiro). `hasMore` diz se ainda há mensagens mais antigas.

```json
{
  "conversation": { "id": "uuid", "phone": "...", "name": "...", "assistantPaused": false, "unreadCount": 0, "lastMessageAt": "...", "lastMessagePreview": "..." },
  "messages": [
    { "id": "uuid", "origin": "customer", "type": "text", "text": "How much are braces?", "status": "received", "error": null, "sentAt": "..." },
    { "id": "uuid", "origin": "assistant", "type": "text", "text": "Braces cost ...", "status": "sent", "error": null, "sentAt": "..." }
  ],
  "hasMore": false
}
```

- **404**: `{"error":"not_found"}`.

### `POST /api/conversations/:id/read`

- **204**: zera a contagem de não lidas (FR-010).

### `PATCH /api/conversations/:id`

Pausa ou reativa o assistente na conversa (FR-020).

- **Corpo**: `{ "assistantPaused": true }`.
- **200**: a conversa atualizada, no mesmo formato da lista.

## Mensagens

### `POST /api/conversations/:id/messages`

Envia uma mensagem do operador (FR-011, FR-022a).

- **Corpo**: `{ "text": "Olá, sou da recepção" }`. O `text` passa por `trim()`, precisa ter de 1 a 4096 caracteres e conserva as quebras de linha.
- **201**: `{ "message": { ...origin: "operator", status: "sent" } }`. O assistente da conversa fica pausado.
- **409**: `{"error":"whatsapp_disconnected"}`, quando o estado não é `open`. Nada é gravado (FR-014).
- **422**: texto vazio ou longo demais.
- **502**: `{ "message": { ...status: "failed", error: "..." } }`. A mensagem fica gravada como `failed`.

### `POST /api/messages/:id/retry`

Reenvia uma mensagem `failed` do operador (FR-013).

- **200**: `{ "message": {...} }`, com `sent`, ou `failed` de novo.
- **409**: a mensagem não é do operador, não está `failed`, ou o WhatsApp está desconectado.

## Eventos em tempo real

### `GET /api/events`

`Content-Type: text/event-stream`. Mantém a conexão aberta; a cada 25 s o servidor manda um comentário `: ping`.

| `event:` | `data:` (JSON) | Quando |
|---|---|---|
| `message.created` | `{ "conversationId", "message" }` | Qualquer mensagem gravada |
| `message.updated` | `{ "conversationId", "message" }` | A situação de um envio mudou (`sent` ou `failed`) |
| `conversation.updated` | `{ "conversation" }` | Prévia, não lidas, nome ou pausa mudaram |
| `connection.updated` | `{ "state", "number", "qr" }` | O estado da conexão mudou ou chegou um QR code novo |

Quando reconecta (`onopen` depois de um `onerror`), o cliente busca de novo `GET /api/conversations`, a conversa aberta e `GET /api/connection`, para recuperar o que perdeu (R3).

## Rotas que não são da API

| Rota | O que faz |
|---|---|
| `/webhooks/evolution` | Webhook da Evolution API, protegido pelo token já existente; ver [evolution.md](evolution.md) |
| `/auth/google/callback` | Callback do OAuth do Google, sem mudança |
| `/health` | Healthcheck do servidor, sem mudança |
| Qualquer outra rota | Em produção, o Fastify entrega os arquivos do `web/dist/` e responde com o `index.html` quando a rota não é um arquivo |
