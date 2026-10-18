# Contract: API do painel — agenda (`/api/calendar*`)

Valem as mesmas regras de [002 panel-api.md](../../002-whatsapp-web-inbox/contracts/panel-api.md): cookie `sf_session`, 401 sem sessão, 503 com o painel desligado, `POST`/`PUT` só com `Content-Type: application/json`, datas em ISO 8601 UTC.

## Agenda

### `GET /api/calendar`

Estado da conexão e regras de atendimento.

```json
{
  "connection": {
    "status": "connected",
    "email": "clinica@gmail.com",
    "calendarId": "primary",
    "calendarName": "DentalSafe",
    "timeZone": "America/Bahia"
  },
  "rules": {
    "weeklyHours": { "1": { "start": "09:00", "end": "18:00" }, "2": { "start": "09:00", "end": "18:00" } },
    "slotMinutes": 60,
    "minNoticeMinutes": 120,
    "maxDaysAhead": 30,
    "cancelNoticeMinutes": 1440
  }
}
```

- `connection.status`: `disconnected` (os outros campos vêm `null`), `connected` ou `needs_reauth` (FR-003).

### `POST /api/calendar/connect`

Começa a conexão (FR-001).

- **Corpo**: `{}`.
- **200**: `{ "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }`. O painel abre essa URL na mesma aba.

### `GET /auth/google/callback` *(pública, fora de `/api`)*

Volta do Google. Não exige o cookie do painel; a proteção é o `state` assinado ([research.md R7](../research.md#r7-conexão-com-o-google-uma-agenda-da-clínica)).

- **Sucesso**: grava a conexão com a agenda principal e redireciona (302) para `${PANEL_URL}/#/agenda?google=connected`.
- **Cancelado pelo operador** (`error=access_denied`): 302 para `${PANEL_URL}/#/agenda?google=denied`. A conexão existente, se houver, não muda (US3, cenário 4).
- **`state` inválido ou expirado, ou falha ao trocar o `code`**: 302 para `${PANEL_URL}/#/agenda?google=error`.
- **Faltou escopo** (o operador desmarcou a agenda na tela do Google): 302 para `?google=missing_scope`, sem gravar.

### `GET /api/calendar/calendars`

Agendas da conta conectada que o operador pode usar (FR-002). Só entram as com `accessRole` `owner` ou `writer`.

- **200**: `{ "calendars": [{ "id": "primary", "name": "DentalSafe", "timeZone": "America/Bahia", "primary": true }] }`.
- **409**: `{"error":"calendar_disconnected"}`.
- **502**: `{"error":"calendar_unavailable"}`.

### `PUT /api/calendar/selection`

- **Corpo**: `{ "calendarId": "..." }`.
- **200**: o mesmo corpo de `GET /api/calendar`.
- **422**: `{"error":"invalid_calendar"}`, quando a agenda não está na lista acima.

### `PUT /api/calendar/rules`

Salva as regras de atendimento (FR-007, FR-008).

- **Corpo**: o objeto `rules` acima, completo.
- **200**: o mesmo corpo de `GET /api/calendar`.
- **422**: `{"error":"invalid_rules","issues":[{"path":"weeklyHours.1.end","message":"..."}]}`.

| Campo | Regra |
|---|---|
| `weeklyHours` | Chaves `"1"` a `"7"` (1 = segunda); `start` e `end` em `HH:mm`, com `start < end`; ao menos um dia |
| `slotMinutes` | Inteiro de 15 a 240, múltiplo de 5, e menor ou igual à janela de cada dia |
| `minNoticeMinutes` | Inteiro de 0 a 10080 |
| `maxDaysAhead` | Inteiro de 1 a 180 |
| `cancelNoticeMinutes` | Inteiro de 0 a 10080 |

A mudança vale para os próximos horários oferecidos. Agendamentos já feitos não mudam.

### `DELETE /api/calendar`

Desconecta (FR-004): revoga o token no Google (uma falha na revogação vai para o log e não impede) e apaga a linha.

- **204**. As sessões de agendamento em andamento são apagadas, e o assistente passa a responder "can't book right now".

## Mudanças nas rotas da feature 002

- `ConversationJson` ganha `needsAttention: boolean` (FR-024b). O painel destaca essas conversas na lista.
- `MessageJson.origin` pode vir `system`: registros de agendamento (FR-018), mostrados no centro do histórico, sem balão de remetente.
- `POST /api/conversations/:id/read` e `PATCH /api/conversations/:id` com `assistantPaused: false` também zeram `needsAttention`.

## Eventos SSE (`GET /api/events`)

Além dos eventos da feature 002:

```json
{ "type": "calendar.updated", "connection": { "status": "needs_reauth", "email": "...", "calendarId": "...", "calendarName": "...", "timeZone": "..." } }
```

Enviado quando a conexão muda: conectou, trocou de agenda, desconectou ou precisa reconectar (US3, cenário 6). Os registros de agendamento chegam como `message.created`, e `needsAttention` chega no `conversation.updated` que já existe.
