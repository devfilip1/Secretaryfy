# Contrato: API do painel — mudanças da feature 004

Estende [specs/002-whatsapp-web-inbox/contracts/panel-api.md](../../002-whatsapp-web-inbox/contracts/panel-api.md). Todas as rotas continuam exigindo a sessão do painel.

## Formatos

### Conversa (`ConversationJson`) — campo novo

```json
{ "...": "campos da 002 e da 003", "optedOut": false }
```

`optedOut` é `true` quando o telefone tem `opted_out_at` em `contact_preferences`.

### Mensagem (`MessageJson`) — status novo

`status` pode ser `"blocked"`. Nesse caso, `error` traz o código do motivo ([data-model.md](../data-model.md#messages)) e o painel mostra "Não enviada pela proteção: <motivo>". Uma mensagem `blocked` não tem botão de reenviar.

### Proteção (`ProtectionJson`)

```json
{
  "state": "normal" | "warmup" | "paused",
  "pausedUntil": "2026-10-18T15:30:00.000Z" | null,
  "reason": "send_failures" | "connection_drops" | null,
  "warmupUntil": "2026-11-01T12:00:00.000Z" | null,
  "limits": { "perMinute": 4, "perHour": 100, "conversationsPerDay": 30 },
  "usage": { "lastMinute": 1, "lastHour": 12, "conversationsToday": 9 }
}
```

`limits` traz os limites em vigor agora, já com a rampa de aquecimento aplicada.

## Rotas novas

### `GET /api/protection`

- **200**: `ProtectionJson`.

### `PATCH /api/conversations/:id` — campo novo

O corpo aceita `{ "optedOut": false }` (reativar), além do `assistantPaused` que já existe. Só a reativação é aceita: o operador não marca saída em nome do cliente.

- **200**: a conversa atualizada.
- **422**: `{ "optedOut": true }`, ou um corpo sem nenhum campo válido.

## Rotas alteradas

### `POST /api/conversations/:id/messages` e `POST /api/messages/:id/retry`

O corpo aceita `confirmRisk?: boolean`.

- **409 `risk_confirmation_required`**: há risco e `confirmRisk` não veio `true`. Nada é gravado.

  ```json
  { "error": "risk_confirmation_required", "risks": ["cold_contact", "opted_out", "protection_paused"] }
  ```

  | Risco | Quando |
  |---|---|
  | `cold_contact` | A última mensagem do cliente tem mais de 24 h, ou ele nunca escreveu |
  | `opted_out` | O cliente pediu para não receber mensagens |
  | `protection_paused` | O freio automático está ativo |

- **429 `retry_too_soon`** (só no retry): a última tentativa dessa mensagem foi há menos de `ANTIBAN_RETRY_MIN_INTERVAL_MS`. A resposta traz `{ "retryAt": "<ISO>" }`.
- **201 / 200**: como antes. A resposta espera a vez da mensagem na fila do número, normalmente alguns segundos, e chega já com o status final.
- **502**: como antes. Inclui a mensagem que não saiu da fila a tempo, com `error` "Não enviada pela proteção: …".

### `POST /api/connection/qr`

- **429 `too_many_attempts`**: mais de `ANTIBAN_QR_ATTEMPTS` pedidos na janela. A resposta traz `{ "retryAt": "<ISO>" }`.

## SSE (`GET /api/events`) — evento novo

| Evento | Dados | Quando |
|---|---|---|
| `protection.updated` | `ProtectionJson` | O freio liga ou desliga, ou o aquecimento começa ou termina |

`conversation.updated` passa a carregar `optedOut`. Na reconexão, o painel também busca `GET /api/protection`.
