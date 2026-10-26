# Contract: Google Calendar (feature 006)

Uma chamada nova no `CalendarGateway` (`src/modules/google/gateway.ts`), implementada em `src/modules/google/calendar.ts` e na agenda falsa dos testes (`src/test/fake-calendar.ts`):

```ts
/** Troca só o título do evento. Sem erro se o evento já não existe (404/410). */
renameEvent(eventId: string, summary: string): Promise<void>;
```

| Método | Chamada | Parâmetros |
|---|---|---|
| `renameEvent` | `calendar.events.patch` | `calendarId`, `eventId`, `sendUpdates: "none"`, corpo `{ summary }` |

Erros, prazo de 10 s e tratamento de `invalid_grant` iguais aos das outras chamadas ([003 contracts/google-calendar.md](../../003-google-calendar-scheduling/contracts/google-calendar.md#erros)).

## Usos

- **Editar o nome do cliente** (research.md R6): para cada horário futuro marcado do telefone, `renameEvent(googleEventId, "<nome novo> — <serviço>")`. Nos horários anteriores à feature 005 (sem serviço), o título fica `"<nome novo> — Assessment"`.
- **Marcar pelo painel**: o mesmo `createEvent` do assistente (`summary`, `description`, `extendedProperties.private`). A descrição passa a dizer a origem: `Marcado pelo Secretaryfy (painel).` ou `Marcado pelo Secretaryfy.`
- **Agendador de lembretes**: `getEvent` antes de enviar, como a sincronização do fluxo (evento apagado → cancelado; movido → horário novo).
- **Disponibilidade no painel**: `busy` com a mesma janela das consultas do assistente.
