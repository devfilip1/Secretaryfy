# Contract: API do painel (feature 006)

Todas as rotas ficam em `/api/*`: exigem a sessão do operador (`panel-session.ts`), e as com corpo exigem `Content-Type: application/json`. Erros seguem o formato atual, `{ "error": "<código>" }`, com campos extras quando indicado.

## Agendamentos

### `GET /api/appointments`

Próximos horários marcados (`status = booked`), de agora até o fim do 7º dia seguinte, no fuso da agenda conectada, em ordem de início.

**200**:

```json
{
  "timeZone": "America/Bahia",
  "appointments": [
    {
      "id": "uuid",
      "startsAt": "2026-10-26T13:00:00.000Z",
      "endsAt": "2026-10-26T14:00:00.000Z",
      "group": "today",
      "customerName": "Maria Souza",
      "service": "Dental Cleaning",
      "phone": "5571999999999",
      "customerId": "uuid | null",
      "notes": "allergic to latex | null",
      "conversationId": "uuid | null",
      "origin": "assistant",
      "reminder": {
        "label": "remind_manually",
        "reason": "outside_window",
        "sentAt": null
      },
      "confirmedAt": null,
      "confirmedBy": null
    }
  ]
}
```

- `group` é `today`, `tomorrow` ou `week` (data-model.md).
- `reminder.label` é `confirmed`, `scheduled`, `remind_manually`, `waiting`, `sent`, `not_sent` ou `not_needed` (data-model.md, "Situação mostrada no painel").
- `service` é `null` nos agendamentos anteriores à feature 005.
- Sem agenda conectada, a resposta é **200** com a lista do banco, e `timeZone` é o fuso de reserva (`FALLBACK_TIME_ZONE`).

### `POST /api/appointments/:id/confirm`

O operador confirma o horário (por exemplo, depois de ligar para o cliente).

- **200** `{ "appointment": AppointmentJson }`. Grava `confirmed_by = operator`. Um lembrete `pending` vira `not_needed`. Publica `appointments.updated`.
- **404** `not_found`: o id não existe ou não é de um horário futuro marcado.
- Confirmar de novo um horário já confirmado é aceito e não muda nada.

### `GET /api/booking/days`

Dias com ao menos um horário livre, pelas regras de atendimento e pela ocupação do Google (as mesmas funções do assistente).

- **200** `{ "timeZone": "America/Bahia", "days": ["2026-10-26", "2026-10-27"] }`.
- **409** `calendar_disconnected`: agenda desconectada ou precisando de reconexão.
- **502** `calendar_unavailable`: o Google não respondeu.

### `GET /api/booking/slots?date=YYYY-MM-DD`

Horários livres do dia.

- **200** `{ "date": "2026-10-26", "slots": ["2026-10-26T12:00:00.000Z", "…"] }`. A lista é vazia num dia fechado, cheio ou fora da janela.
- **422** `invalid_date`.
- **409** `calendar_disconnected` e **502** `calendar_unavailable`, como acima.

### `GET /api/booking/lookup?phone=...`

Preenche o formulário: normaliza o telefone e devolve o que já se sabe dele.

**200**:

```json
{
  "phone": "5571999999999",
  "name": "Maria Souza",
  "hasConversation": true,
  "futureAppointment": null
}
```

- `name` vem do cadastro ou da conversa, e é `null` se não houver.
- `futureAppointment` é um `AppointmentJson` ou `null`.
- **422** `invalid_phone`: depois de normalizado, não tem de 12 a 15 dígitos (research.md R8).

### `POST /api/appointments`

Marca pelo painel com o mesmo motor do assistente (research.md R2).

Corpo:

```json
{ "phone": "(71) 99999-9999", "name": "Maria Souza", "service": "Dental Cleaning", "start": "2026-10-26T12:00:00.000Z" }
```

Regras de validação:
- `phone`: normalizado (R8).
- `name`: 1 a 120 caracteres depois de tirar os espaços das pontas.
- `service`: um dos 8 tratamentos do catálogo da feature 005, ou `Assessment`.
- `start`: data ISO.

Respostas:
- **201** `{ "appointment": AppointmentJson }`. O evento foi criado no Google com o título `"<nome> — <serviço>"`, o cliente entrou ou foi atualizado no cadastro, e o horário tem `origin = panel`. O lembrete fica `pending`, ou `not_needed` se faltarem menos de 24 h. Publica `appointments.updated` e `customers.updated`. Se houver conversa para o telefone, registra no histórico `"📅 Booked from the panel: … (60 min) — <serviço>"`. Nenhuma mensagem vai ao cliente (FR-019).
- **409** `slot_taken`, com `{ "date": "...", "slots": [...] }`: os horários livres do mesmo dia, de novo (FR-014).
- **409** `already_booked`, com `{ "appointment": AppointmentJson }`: o telefone já tem um horário futuro (FR-017).
- **409** `calendar_disconnected` e **502** `calendar_unavailable`.
- **422** `invalid_body`, com `{ "issues": [{ "path": "phone", "message": "..." }] }`.

## Clientes (alterações da feature 005)

### `GET /api/customers`

Cada cliente ganha dois campos:

```json
{ "notes": "prefers mornings | null", "conversationId": "uuid | null" }
```

`conversationId` é a conversa achada pelo telefone; com `null`, o botão "View conversation" fica desativado.

### `PATCH /api/customers/:id`

Corpo com pelo menos um destes campos:

```json
{ "name": "Maria Souza", "notes": "allergic to latex" }
```

Regras de validação:
- `name`: 1 a 120 caracteres depois de tirar os espaços das pontas.
- `notes`: até 1.000 caracteres. `""` ou `null` apaga a anotação.

Respostas:
- **200** `{ "customer": CustomerJson, "calendarUpdated": true }`.
  - Ao trocar o nome: atualiza a conversa do telefone e os horários futuros, e renomeia os eventos no Google (research.md R6).
  - `calendarUpdated` é `false` se algum evento não pôde ser renomeado; o nome fica salvo mesmo assim.
  - Sem troca de nome, `calendarUpdated` é `true`.
  - Publica `customers.updated`, e `appointments.updated` quando o nome muda.
- **404** `not_found`.
- **422** `invalid_body`, com `issues`.

`DELETE /api/customers/:id` continua igual (feature 005).

## Eventos SSE (`GET /api/events`)

- **Novo** `{ "type": "appointments.updated" }`, sem dados: a aba de agendamentos busca a lista de novo. Publicado quando um horário é marcado (pelo WhatsApp ou pelo painel), remarcado, cancelado (pelo cliente ou no Google) ou confirmado, e quando a situação do lembrete muda.
- `customers.updated` (feature 005) passa a sair também no `PATCH`.

## Navegação do painel

| Hash | Tela |
|---|---|
| `#/appointments` | Aba Appointments (nova) |
| `#/?c=<conversationId>` | Conversations com a conversa aberta (novo parâmetro) |
| `#/connection`, `#/calendar`, `#/customers` | Como hoje |
