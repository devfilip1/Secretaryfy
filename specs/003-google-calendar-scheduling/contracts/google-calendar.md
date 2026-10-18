# Contract: Google Calendar API v3

Chamadas feitas por `src/modules/google/calendar.ts`, com `googleapis@186.0.0` e o cliente OAuth de `src/modules/google/oauth.ts`. Os testes usam uma implementação falsa da mesma interface:

```ts
interface CalendarGateway {
  listCalendars(): Promise<{ id: string; name: string; timeZone: string; primary: boolean }[]>;
  busy(from: Date, to: Date): Promise<{ start: Date; end: Date }[]>;
  createEvent(e: NewEvent): Promise<{ eventId: string }>;
  getEvent(eventId: string): Promise<{ start: Date; end: Date } | null>; // null = apagado
  moveEvent(eventId: string, start: Date, end: Date): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;                          // 404/410 = já apagado, sem erro
}
```

## OAuth

- **Escopos**: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly` e `https://www.googleapis.com/auth/calendar.events.freebusy`.
- **URL de consentimento**: `access_type=offline`, `prompt=consent`, `include_granted_scopes=false` e `state` assinado.
- **Redirect URI**: `${PUBLIC_URL}/auth/google/callback`, cadastrada no Google Cloud Console.
- **Escopos concedidos**: o callback confere `tokens.scope`. Faltando algum de agenda, não grava e devolve `missing_scope`.
- **Revogação**: `POST https://oauth2.googleapis.com/revoke?token=<refresh_token>`.

## Chamadas

| Método | Chamada | Parâmetros |
|---|---|---|
| `listCalendars` | `calendar.calendarList.list` | `minAccessRole: "writer"` |
| `busy` | `calendar.freebusy.query` | `{ timeMin, timeMax, timeZone, items: [{ id: calendarId }] }`. Usa `calendars[calendarId].busy`. Se vier `errors`, lança `CalendarUnavailable` |
| `createEvent` | `calendar.events.insert` | `calendarId`, `sendUpdates: "none"`, corpo com `summary`, `description`, `start/end.dateTime` + `timeZone`, `extendedProperties.private` ([conversation.md](conversation.md#evento-no-google-agenda)) |
| `getEvent` | `calendar.events.get` | `null` quando 404/410 ou `status = "cancelled"` |
| `moveEvent` | `calendar.events.patch` | `start`, `end`, `sendUpdates: "none"` |
| `deleteEvent` | `calendar.events.delete` | `sendUpdates: "none"` |

- **Tempo limite**: 10 s por chamada.
- **Janela do `busy`**: a consulta de dias usa `[agora, agora + maxDaysAhead]` numa chamada só. A de um dia usa só aquele dia. A confirmação usa só o horário escolhido.

## Erros

| Situação | Tratamento |
|---|---|
| `invalid_grant` ao renovar o token | `calendar_connection.status = needs_reauth`, publica `calendar.updated` e lança `CalendarUnavailable` |
| 401/403 de escopo | Igual a `invalid_grant` |
| 404 da agenda escolhida (apagada ou sem acesso) | `needs_reauth` (o operador escolhe outra) |
| 429, 5xx, timeout, rede | `CalendarUnavailable`, sem mudar a conexão. Uma nova tentativa só na próxima mensagem do cliente |
