# Contrato: chamadas à Evolution API (v2.3.7) — mudanças da feature 004

Estende [specs/002-whatsapp-web-inbox/contracts/evolution.md](../../002-whatsapp-web-inbox/contracts/evolution.md). Todas as chamadas levam o header `apikey` e o timeout de 10 s que já existe.

## Enviar texto com "digitando…"

`POST /message/sendText/{instance}`

```json
{ "number": "5511999999999", "text": "…", "delay": 4200, "linkPreview": false }
```

- `delay` (ms): a Evolution mostra "digitando…" por esse tempo e só então envia. O valor vem de research.md R3, entre `ANTIBAN_TYPING_MIN_MS` e `ANTIBAN_TYPING_MAX_MS`.
- `linkPreview: false`: sem prévia de link.
- O timeout da chamada passa a ser `delay + 10 s`, porque a resposta só chega depois do envio.
- A resposta é a mesma de antes (`key.id`). Erros viram `failed` com o texto do erro e contam para o freio.

## Marcar como lidas

`POST /chat/markMessageAsRead/{instance}`

```json
{ "readMessages": [{ "remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "<wa_message_id>" }] }
```

- Leva as mensagens do cliente desde a última resposta do assistente.
- Uma falha vai para o log em `warn` e não impede a resposta.

## Evento `connection.update` — uso novo

- **Quedas:** um `state: "close"` sem `statusReason` 401 conta como queda para o freio (research.md R11). Um `close` com 401 continua limpando as conversas, como antes.
- **Aquecimento:** um `state: "open"` com `wuid` grava ou atualiza `connected_numbers` (research.md R10).

## A confirmar no quickstart

A documentação pública da v2 é escassa. Antes de fechar a implementação, a §1 do [quickstart.md](../quickstart.md) confirma na instância local três pontos:
- o nome do endpoint de leitura;
- que `delay` mostra "digitando…";
- que `linkPreview` é aceito no corpo.

Se algum deles divergir, o ajuste fica restrito a `src/modules/whatsapp/evolution.ts`.
