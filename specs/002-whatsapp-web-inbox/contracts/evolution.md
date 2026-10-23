# Contract: integração com a Evolution API v2

> A feature 004 estende este contrato: `sendText` com `delay` e `linkPreview`, `markMessageAsRead`, e o uso de `connection.update` para o freio e o aquecimento. Ver [specs/004-whatsapp-anti-ban/contracts/evolution.md](../../004-whatsapp-anti-ban/contracts/evolution.md).

Este documento descreve o que o Secretaryfy **consome**: os eventos que chegam no webhook e as chamadas que faz à Evolution API. Todas as chamadas levam o header `apikey: ${EVOLUTION_API_KEY}` e usam a instância `${EVOLUTION_INSTANCE}`.

> Os nomes vêm da documentação da v2 (ver [research.md R7](../research.md#r7-eventos-da-evolution-api)). O §0 do [quickstart.md](../quickstart.md) confere esses nomes contra a instância real antes da implementação.
>
> **Status em 2026-10-16: verificado contra a Evolution API v2.3.7** (`docker-compose.yml`). Chave errada dá 401. `connectionState` e `fetchInstances` de uma instância inexistente dão 404, e com isso o Secretaryfy cria a instância. `webhook/set` grava os 4 eventos com `webhookByEvents: false`. `instance/connect` devolve `base64` com a imagem do QR code. O webhook usa `WEBHOOK_BASE_URL` quando a Evolution roda no Docker. Ainda faltam os eventos de mensagem com um celular conectado.

## Webhook recebido: `POST /webhooks/evolution?token=...`

O token é o já existente da feature 001: inválido dá 401. Para qualquer evento conhecido ou desconhecido, a resposta é sempre **200** imediato, e o processamento continua em segundo plano.

### `messages.upsert` e `send.message`

```json
{
  "event": "messages.upsert",
  "instance": "secretaryfy",
  "data": {
    "key": { "id": "3EB0...", "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false },
    "pushName": "Maria",
    "messageTimestamp": 1792118106,
    "message": { "conversation": "How much are braces?" }
  }
}
```

| Regra | Comportamento |
|---|---|
| `remoteJid` não termina em `@s.whatsapp.net` (grupo, status, broadcast) | Ignorado |
| Sem `key.id` | Ignorado |
| `fromMe: false` | Mensagem do cliente (`origin = customer`) |
| `fromMe: true` | Regra de eco ([research.md R6](../research.md#r6-eco-das-mensagens-enviadas)): mensagem do sistema já gravada, ou mensagem enviada pelo celular (`phone`) |
| `pushName` em mensagem com `fromMe: true` | Não é usado como nome do cliente |

**Como o tipo e o texto são extraídos de `data.message`** (a primeira chave presente decide):

| Chave | `type` | `text` |
|---|---|---|
| `conversation` | text | o valor |
| `extendedTextMessage.text` | text | o valor |
| `imageMessage` | image | `.caption` ou null |
| `videoMessage` | video | `.caption` ou null |
| `audioMessage` | audio | null |
| `documentMessage` / `documentWithCaptionMessage` | document | `.caption` / `.fileName` ou null |
| `stickerMessage` | sticker | null |
| `locationMessage` / `liveLocationMessage` | location | null |
| `contactMessage` / `contactsArrayMessage` | contact | `.displayName` ou null |
| `reactionMessage`, `protocolMessage` (apagar/editar) | — | Ignorado (fora do escopo) |
| Qualquer outra | other | null |

Mensagens de texto vazias ou só com espaços também são ignoradas.

### `connection.update`

```json
{ "event": "connection.update", "data": { "state": "open", "wuid": "5511988887777@s.whatsapp.net" } }
```

Atualiza o estado em memória (`open`, `connecting` ou `close`) e o número, extraído de `wuid`. Quando chega `open`, o QR code em memória é apagado. Toda mudança publica `connection.updated` no SSE.

### `qrcode.updated`

```json
{ "event": "qrcode.updated", "data": { "qrcode": { "base64": "data:image/png;base64,..." } } }
```

Guarda o QR code em memória e publica `connection.updated`.

## Chamadas feitas pelo Secretaryfy

| Função (`src/modules/whatsapp/`) | Chamada | Uso |
|---|---|---|
| `sendWhatsAppText(number, text)` | `POST /message/sendText/{instance}` `{ number, text }` | **Muda**: passa a devolver `key.id` da resposta (`{ key: { id } }`), usado na regra de eco |
| `getConnectionState()` | `GET /instance/connectionState/{instance}` → `{ instance: { state } }` | Polling a cada 10 s, enquanto houver painel aberto |
| `getConnectedNumber()` | `GET /instance/fetchInstances?instanceName={instance}` → `[{ ownerJid }]` | Número mostrado no painel |
| `ensureInstance()` | Em caso de 404 do `connectionState`: `POST /instance/create` `{ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }` | Antes de pedir o QR code |
| `configureWebhook()` | `POST /webhook/set/{instance}` `{ webhook: { enabled: true, url, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "SEND_MESSAGE", "CONNECTION_UPDATE", "QRCODE_UPDATED"] } }` | A cada `POST /api/connection/qr` (FR-019) |
| `requestQrCode()` | `GET /instance/connect/{instance}` → `{ base64 }` | QR code mostrado no painel |
| `logout()` | `DELETE /instance/logout/{instance}` | `DELETE /api/connection` |

Qualquer resposta que não seja 2xx, ou falha de rede, vira `EvolutionError` com o status e o corpo. Nas rotas do painel, isso é traduzido para 502.
