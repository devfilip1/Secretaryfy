---

description: "Task list for feature 006 — agendamentos no painel, ficha do cliente e lembrete pelo WhatsApp"
---

# Tasks: Agendamentos no painel, ficha do cliente e lembrete pelo WhatsApp

**Input**: Design documents from `/specs/006-panel-appointments-reminders/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Incluídos, como nas features anteriores:
- `node:test` sem rede, com PGlite (`src/test/db.ts`), agenda falsa (`src/test/fake-calendar.ts`), Ollama falso e o portão com `TEST_ANTIBAN`.
- Os testes ficam ao lado do módulo (`*.test.ts`) e são escritos antes da implementação da mesma história.

**Organization**: Uma fase por história do spec, na ordem de prioridade. US1 e US2 são P1; US3 e US4 são P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo, porque mexe em arquivos diferentes e não depende de tarefa incompleta
- **[Story]**: história do spec (US1 a US4)
- Os caminhos são relativos à raiz do Secretaryfy

## Convenções que valem para todas as tarefas

- **Idioma:** código e comentários de `src/` e `web/src/` em português. Textos ao cliente em inglês, exatamente como em [contracts/conversation.md](contracts/conversation.md). Telas e registros do painel em inglês.
- **Imports:** em `src/` terminam em `.js`.
- **Arquivos:** usam CRLF. Para trechos com `\` (regex, `\n`), use a ferramenta de edição, não heredoc de shell.
- **Envio:** todo envio ao WhatsApp sai pelo `gate.sendAssistant` ou pelo `gate.sendOperator`. Nada fora da janela de 24 h do cliente (opção B da spec).
- **Telefone:** depois da Phase 2, nenhum código de agendamento busca horário pela conversa. Ao final, `grep -n "findFutureBooked(this.conversation.id" src -r` não mostra nenhuma linha.
- **Tempo real:** toda mudança em `appointments` feita pelo processo passa pelo store embrulhado de `src/routes/scheduling.ts`, que publica `appointments.updated`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Banco e configuração que as quatro histórias usam.

- [X] T001 Alterar `src/db/schema.ts` conforme [data-model.md](data-model.md):
  - Novo `pgEnum("reminder_status", ["pending", "sent", "not_sent", "not_needed"])`.
  - Em `appointments`:
    - `conversationId` passa a ser opcional, com `.references(() => conversations.id, { onDelete: "set null" })`;
    - novas colunas `phone` (text not null), `origin` (text not null, default `'assistant'`), `reminderStatus` (`reminder_status` not null, default `'not_needed'`), `reminderReason` (text), `reminderSentAt` (timestamptz), `confirmedAt` (timestamptz) e `confirmedBy` (text);
    - novos índices `appointments_phone_idx` em `(phone, startsAt)` e `appointments_reminder_idx` em `(reminderStatus, startsAt)`.
  - Em `customers`: nova coluna `notes` (text).
  - Exportar o tipo `ReminderStatus`.
- [X] T002 Gerar a migration com `npm run db:generate` e renomeá-la para `drizzle/0006_appointments_panel.sql` (ajustando `drizzle/meta/_journal.json`). Editar o SQL para preencher os registros existentes:
  1. adicionar `phone` sem `NOT NULL`;
  2. `UPDATE appointments a SET phone = c.phone FROM conversations c WHERE c.id = a.conversation_id`;
  3. `ALTER COLUMN phone SET NOT NULL`.

  Os registros existentes ficam com `reminder_status = 'not_needed'` (o default) e `origin = 'assistant'`. A FK de `conversation_id` é recriada com `ON DELETE SET NULL`. Rodar `npm test` para confirmar que as migrations aplicam no PGlite, e depois `npm run db:migrate` no banco local.
- [X] T003 [P] Em `src/config/env.ts`, adicionar `REMINDER_LEAD_MINUTES` (padrão 1440), `REMINDER_CUTOFF_MINUTES` (padrão 120) e `REMINDER_TICK_MS` (padrão 60000), com o helper `count` que já existe. Documentar as três em `.env.example`, comentadas como opções para testar com prazos curtos.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Agendamento ligado ao telefone, e não à conversa (research.md R1); situação do lembrete; conversa achada pelo telefone; o evento SSE `appointments.updated`. Ao fim desta fase, nada muda para o cliente: o assistente marca, cancela e remarca como antes.

**⚠️ CRITICAL**: Nenhuma história começa antes desta fase.

- [X] T004 [P] Criar `src/modules/reminders/status.ts`, sem I/O:
  - `initialReminderStatus(start: Date, now: Date, leadMinutes: number): "pending" | "not_needed"` devolve `pending` quando faltam pelo menos `leadMinutes`.
  - `reminderLabel(appt, now, { leadMinutes }): "confirmed" | "scheduled" | "remind_manually" | "waiting" | "sent" | "not_sent" | "not_needed"` segue a tabela "Situação mostrada no painel" de [data-model.md](data-model.md). Os motivos `outside_window` e `no_conversation` dão `remind_manually`.
- [X] T005 [P] Criar `src/modules/reminders/status.test.ts` cobrindo cada linha da tabela, mais a borda de exatamente 24 h.
- [X] T006 Em `src/modules/scheduling/sessions.ts`:
  - `findFutureBooked(phone, now)` passa a filtrar por `appointments.phone`.
  - `insertBooked` recebe `phone`, `origin: "assistant" | "panel"`, `conversationId: string | null` e `reminderStatus`.
  - `updateTimes(id, startsAt, endsAt, reminderStatus)` passa a gravar também `reminderStatus` e a limpar `reminderReason`, `reminderSentAt`, `confirmedAt` e `confirmedBy` (data-model.md, "Mudanças de comportamento").
- [X] T007 [P] Criar ou ampliar `src/modules/scheduling/sessions.test.ts` (PGlite):
  - `findFutureBooked` acha pelo telefone um horário de outra conversa e um sem conversa;
  - `updateTimes` limpa a confirmação e o lembrete;
  - apagar a conversa (`deleteAllConversations` de `src/modules/inbox/repository.ts`) mantém o agendamento, com `conversation_id` nulo.
- [X] T008 Em `src/modules/scheduling/flow.ts`:
  - `currentAppointment()` chama `findFutureBooked(this.conversation.phone, …)`;
  - `book()` passa `phone: this.conversation.phone`, `origin: "assistant"` e `reminderStatus: initialReminderStatus(start, this.now, leadMinutes)`;
  - `move()` e `sync()` passam o `reminderStatus` recalculado para o horário novo.

  `leadMinutes` chega pelo `Deps` do fluxo como `reminderLeadMinutes`, com padrão 1440.
- [X] T009 Ajustar `src/modules/scheduling/flow.test.ts` aos novos parâmetros. Adicionar um teste: um horário marcado com o mesmo telefone em outra conversa bloqueia uma segunda marcação e aparece em "my appointment" (US3, cenário 7). Conferir que todos os testes de fluxo continuam passando.
- [X] T010 [P] Em `src/modules/inbox/repository.ts`, adicionar `findConversationByPhone(phone)` e `conversationIdsByPhone(phones: string[]): Promise<Map<string, string>>`. Testar em `src/modules/inbox/repository.test.ts`.
- [X] T011 [P] Adicionar `{ type: "appointments.updated" }` ao tipo `InboxEvent` em `src/modules/inbox/events.ts`, e ao tipo e à lista `SERVER_EVENTS` em `web/src/useEvents.ts`.
- [X] T012 Criar `src/routes/scheduling.ts` com as instâncias do processo:
  - `schedulingStore`: um `createSchedulingStore(db)` embrulhado (como o `customerRepo` de `src/routes/inbox.ts`), que publica `appointments.updated` no `bus` depois de cada método que grava em `appointments` (`insertBooked`, `markCancelled`, `updateTimes`, `setCustomer` e os métodos novos das próximas fases).
  - `schedulingFlow`: o `createSchedulingFlow` hoje montado em `src/routes/evolution-webhook.ts`, com `reminderLeadMinutes: env.REMINDER_LEAD_MINUTES`.

  `src/routes/evolution-webhook.ts` passa a importar os dois de lá.
- [X] T013 Atualizar `scripts/eval-scheduling.ts` para o `insertBooked` e o `findFutureBooked` novos, pelo telefone. Rodar `npx tsx --env-file=.env scripts/eval-scheduling.ts` e confirmar 23/23.

**Checkpoint**: `npm run typecheck` e `npm test` verdes; marcar, cancelar e remarcar pelo WhatsApp funcionam como antes; "Delete all conversations" não apaga mais os horários.

---

## Phase 3: User Story 1 - Aba de agendamentos com os próximos horários (Priority: P1) 🎯 MVP

**Goal**: O dono vê na aba Appointments os horários de hoje, de amanhã e dos próximos 7 dias, com nome, serviço, telefone, anotações e situação do lembrete, e abre a conversa do cliente com um clique.

**Independent Test**: Marcar dois horários pelo WhatsApp (hoje ou amanhã, e daqui a 3 dias), abrir Appointments e conferir os grupos e os campos; cancelar um pelo WhatsApp e ver a linha sumir sem recarregar; clicar para abrir a conversa ([quickstart.md](quickstart.md) §2).

### Tests for User Story 1

- [X] T014 [P] [US1] Em `src/modules/scheduling/sessions.test.ts`, testar `listUpcoming(from, to)`:
  - só horários `booked` dentro do intervalo, em ordem de início;
  - traz `notes` do cliente (pelo `customer_id`, ou pelo telefone se o vínculo tiver caído);
  - cancelados e passados ficam de fora.
- [X] T015 [P] [US1] Criar `src/routes/panel-appointments.test.ts`, no padrão de `src/routes/panel-customers.test.ts` (dependências falsas), para `GET /api/appointments`:
  - `group` calculado no fuso devolvido (`today` e `tomorrow` na virada do dia no fuso da agenda, e não no UTC);
  - `conversationId` achado pelo telefone, ou `null`;
  - `reminder.label` vindo de `reminderLabel`;
  - formato igual ao de [contracts/panel-api.md](contracts/panel-api.md);
  - sem agenda conectada, 200 com `FALLBACK_TIME_ZONE`.

### Implementation for User Story 1

- [X] T016 [US1] Em `src/modules/scheduling/sessions.ts`, adicionar `listUpcoming(from: Date, to: Date)`: agendamentos `booked` com `startsAt` no intervalo, com `left join` em `customers` (por `customer_id` ou `phone`) para `notes` e o nome do cadastro, em ordem de `startsAt`.
- [X] T017 [US1] Criar `src/routes/panel-appointments.ts` com `panelAppointmentsRoutes({ store, inbox, connection, now, reminderLeadMinutes })`. A rota `GET /api/appointments`:
  - pega o fuso de `connection.getForUse()` (ou `FALLBACK_TIME_ZONE`);
  - calcula `to` como o fim do 7º dia seguinte nesse fuso (luxon);
  - lista com `listUpcoming`;
  - acha as conversas com `conversationIdsByPhone`;
  - monta o `AppointmentJson` do contrato, com `group` e `reminder.label`.
- [X] T018 [US1] Registrar `panelAppointmentsRoutes` em `src/index.ts` com `schedulingStore` (de `src/routes/scheduling.ts`), `inboxRepo` e `connectionStore`.
- [X] T019 [P] [US1] Em `web/src/api.ts`, adicionar os tipos `AppointmentJson` e `ReminderLabel` e a função `listAppointments()`.
- [X] T020 [US1] Criar `web/src/pages/Appointments.tsx`:
  - seções **Today**, **Tomorrow** e **Next 7 days**, só com as que têm itens;
  - cada linha com hora (e dia, em Next 7 days), nome, serviço, telefone formatado (`formatPhone`), anotações em destaque discreto e a situação do lembrete como etiqueta;
  - **Open conversation** leva a `#/?c=<conversationId>`, e fica oculto sem conversa;
  - aviso "No appointments in the next 7 days." quando a lista está vazia;
  - recarrega com `appointments.updated`, `customers.updated` e `reconnected` (via `useInboxEvents`).
  - Rótulos das etiquetas: `Confirmed`, `Reminder scheduled`, `Remind manually`, `Waiting`, `Reminder sent`, `Reminder not sent: <motivo>` e nada para `not_needed`.
- [X] T021 [US1] Em `web/src/App.tsx`, adicionar a aba **Appointments** (`#/appointments`) entre Conversations e Connection, com a view `appointments`.
- [X] T022 [US1] Em `web/src/pages/Inbox.tsx`, ler `c` da query do hash (`#/?c=<id>`):
  - ao montar e em `hashchange`, selecionar essa conversa;
  - ao selecionar ou fechar uma conversa, atualizar o hash com `history.replaceState`, sem navegar.
- [X] T023 [P] [US1] Em `web/src/styles.css`, estilos de `.appointments-page`, dos grupos, das linhas e das etiquetas de situação (cores com as variáveis `--ok`, `--warn`, `--bad` e `--muted`), mais as regras da seção "Celular" (linha empilhada, sem rolagem horizontal em 375px).

**Checkpoint**: US1 completa e testável sozinha ([quickstart.md](quickstart.md) §2).

---

## Phase 4: User Story 2 - Ficha do cliente: editar nome, anotações e abrir a conversa (Priority: P1)

**Goal**: Na aba Customers, o dono corrige o nome (e o título dos eventos futuros acompanha), escreve anotações e abre a conversa do cliente.

**Independent Test**: Trocar o nome de um cliente com horário futuro e conferir a ficha, a conversa e o título no Google Agenda; salvar uma anotação e vê-la depois de recarregar e na aba Appointments; abrir a conversa pela ficha ([quickstart.md](quickstart.md) §3).

### Tests for User Story 2

- [X] T024 [P] [US2] Em `src/modules/customers/repository.test.ts`:
  - `update(id, { name })` e `update(id, { notes })` mudam só o campo pedido e o `updatedAt`;
  - `notes: null` apaga a anotação;
  - id desconhecido devolve `null`;
  - `list()` traz `notes`.
- [X] T025 [P] [US2] Em `src/routes/panel-customers.test.ts`, testar `PATCH /api/customers/:id`:
  - nome válido: grava, troca o nome da conversa do telefone, renomeia os eventos futuros na agenda falsa e devolve `calendarUpdated: true`;
  - com o `renameEvent` falhando: 200 com `calendarUpdated: false` e o nome salvo;
  - nome vazio ou só com espaços e anotação com mais de 1.000 caracteres: 422 com `issues`;
  - 404 para id desconhecido;
  - `GET /api/customers` passa a trazer `notes` e `conversationId`;
  - publica `customers.updated`, e `appointments.updated` quando o nome muda.

### Implementation for User Story 2

- [X] T026 [P] [US2] Adicionar `renameEvent(eventId, summary)` ao `CalendarGateway` em `src/modules/google/gateway.ts`. Implementar em `src/modules/google/calendar.ts` com `calendar.events.patch({ calendarId, eventId, sendUpdates: "none", requestBody: { summary } })`, tratando 404/410 como sucesso e os erros como as outras chamadas ([contracts/google-calendar.md](contracts/google-calendar.md)). Implementar também em `src/test/fake-calendar.ts`, com contador em `calls` e falha simulável como os outros métodos.
- [X] T027 [P] [US2] Em `src/modules/customers/repository.ts`, adicionar `update(id, { name?, notes? }, at)`, que devolve a linha ou `null`, e incluir `notes` no `list()`.
- [X] T028 [P] [US2] Em `src/modules/scheduling/sessions.ts`, adicionar `futureBookedByPhone(phone, now)` (todos os horários futuros marcados do telefone) e `setCustomerName(appointmentId, name)`.
- [X] T029 [P] [US2] Em `src/modules/inbox/repository.ts` e `src/modules/inbox/service.ts`, adicionar `setCustomerNameByPhone(phone, name)`, que troca `customer_name` da conversa do telefone e publica `conversation.updated` pelo `publishRow`.
- [X] T030 [US2] Em `src/routes/panel-customers.ts`, adicionar `PATCH /api/customers/:id`, com corpo validado por zod conforme [contracts/panel-api.md](contracts/panel-api.md). Ao trocar o nome:
  - `customers.update`;
  - `inbox.setCustomerNameByPhone`;
  - para cada `futureBookedByPhone`: `store.setCustomerName` e `calendar.renameEvent(googleEventId, \`${name} — ${service ?? "Assessment"}\`)`.

  Uma falha do Google vira `calendarUpdated: false`, sem interromper. A rota publica os eventos SSE. O `GET` passa a incluir `notes` e `conversationId` (`conversationIdsByPhone`). Ampliar o `Deps` com `calendar`, `store`, `inboxRepo` e `now`, e ajustar o registro em `src/index.ts`.
- [X] T031 [P] [US2] Em `web/src/api.ts`, adicionar `notes` e `conversationId` ao tipo `Customer`, e a função `updateCustomer(id, { name?, notes? })`, que devolve `{ customer, calendarUpdated }`.
- [X] T032 [US2] Em `web/src/pages/Customers.tsx`, na ficha aberta:
  - nome editável (botão **Edit** → campo + **Save**/**Cancel**; nome vazio desabilita o Save);
  - campo **Notes** (textarea com contador `n/1000` e **Save notes**);
  - aviso "Name saved, but the calendar event title could not be updated." quando `calendarUpdated` for `false`;
  - botão **View conversation** para `#/?c=<conversationId>`, desativado sem conversa, com o `title` "No WhatsApp conversation with this customer".

  Mostrar a anotação (resumida) também na linha da lista.
- [X] T033 [P] [US2] Em `web/src/styles.css`, estilos do modo de edição da ficha e do campo de anotações, inclusive na seção "Celular".

**Checkpoint**: US2 completa e testável sozinha ([quickstart.md](quickstart.md) §3).

---

## Phase 5: User Story 3 - Marcar um horário pelo painel (Priority: P2)

**Goal**: O operador marca para quem ligou, vendo só horários livres calculados como o assistente calcula, e o horário fica igual a um marcado pelo WhatsApp.

**Independent Test**: Marcar pelo painel para um telefone novo e conferir o evento no Google, a linha em Appointments, o cliente em Customers e que o assistente não oferece mais aquele horário; tentar de novo para o mesmo telefone e ver o aviso ([quickstart.md](quickstart.md) §4).

### Tests for User Story 3

- [X] T034 [P] [US3] Criar `src/modules/scheduling/phone.test.ts` para `normalizePhone`:
  - `(71) 99999-9999`, `+55 71 99999-9999`, `071999999999` e `5571999999999` dão `5571999999999`;
  - entradas curtas, longas ou sem dígitos dão `null`.
- [X] T035 [P] [US3] Criar `src/modules/scheduling/booking.test.ts` (PGlite + agenda falsa) para `bookSlot`:
  - cria o evento com `"<nome> — <serviço>"` e a descrição com a origem;
  - grava `phone`, `origin`, `conversationId` (ou `null`) e o `reminderStatus` inicial;
  - faz upsert do cliente;
  - registra no histórico quando há conversa;
  - devolve `already_booked` com outro horário futuro no telefone;
  - devolve `slot_taken` com o horário ocupado e quando o índice único recusa (desfazendo o evento);
  - devolve `calendar_unavailable` com a agenda desconectada.
- [X] T036 [P] [US3] Em `src/routes/panel-appointments.test.ts`:
  - `GET /api/booking/days`, `GET /api/booking/slots` (com `invalid_date`) e `GET /api/booking/lookup` (telefone normalizado, nome do cadastro ou da conversa, `futureAppointment`, `invalid_phone`);
  - `POST /api/appointments`: 201, os 409 `slot_taken` (com os horários do dia), `already_booked` e `calendar_disconnected`, e 422 com `issues` para telefone, nome e serviço inválidos;
  - nenhum envio ao WhatsApp em nenhum caso (FR-019).

### Implementation for User Story 3

- [X] T037 [P] [US3] Criar `src/modules/scheduling/phone.ts` com `normalizePhone(input): string | null` (research.md R8).
- [X] T038 [US3] Criar `src/modules/scheduling/booking.ts` com `createBooking({ calendar, connection, rules, store, inbox, customers, log, now, reminderLeadMinutes })` e `bookSlot({ phone, name, service, start, origin, conversationId })`. É o corpo de `Run.book()` e de `Run.registerCustomer()` de `src/modules/scheduling/flow.ts`, sem as respostas ao cliente:
  - trava com `withCalendarLock`;
  - `findFutureBooked(phone)` com a sincronização do evento no Google;
  - `busy` + `isSlotAvailable`;
  - `createEvent` com a descrição `Marcado pelo Secretaryfy.` ou `Marcado pelo Secretaryfy (painel).`;
  - `insertBooked` (desfaz o evento se o índice recusar);
  - upsert do cliente + `setCustomer`;
  - registro no histórico quando há conversa: `systemNotes.booked` ou `systemNotes.bookedFromPanel`.

  Retorno: `{ kind: "booked", appointment } | { kind: "slot_taken" } | { kind: "already_booked", appointment } | { kind: "calendar_unavailable" }`. Adicionar `systemNotes.bookedFromPanel` em `src/modules/scheduling/replies.ts`, conforme [contracts/conversation.md](contracts/conversation.md).
- [X] T039 [US3] Em `src/modules/scheduling/flow.ts`, fazer `Run.book()` chamar `bookSlot` e transformar o retorno nas respostas de hoje (`booked`, `slotTaken`, `offerReschedule`). Remover o código duplicado (`registerCustomer`). A sincronização do evento (`sync`) passa a ser usada pelos dois. `flow.test.ts` continua verde sem mudar as expectativas.
- [X] T040 [US3] Em `src/routes/scheduling.ts`, exportar a instância `booking` (`createBooking` com o store embrulhado, `googleCalendar`, `connectionStore`, `rulesStore`, `inbox` e `customerRepo`), usada pelo fluxo e pelo painel.
- [X] T041 [US3] Em `src/routes/panel-appointments.ts`, adicionar as rotas do contrato:
  - `GET /api/booking/days` e `GET /api/booking/slots?date=`, com `availableDays` e `slotsForDay` de `src/modules/scheduling/availability.ts` sobre o `busy` da janela de `bookingWindow`;
  - `GET /api/booking/lookup?phone=`;
  - `POST /api/appointments`, com `normalizePhone`, o serviço validado contra `SERVICES` + `ASSESSMENT` de `src/modules/scheduling/services.ts` e `booking.bookSlot({ origin: "panel", conversationId: <achada pelo telefone> })`. Mapear os retornos para 201, 409 e 502.

  Agenda desconectada → 409 `calendar_disconnected`; `CalendarUnavailable` → 502.
- [X] T042 [P] [US3] Em `web/src/api.ts`, adicionar `bookingDays()`, `bookingSlots(date)`, `lookupPhone(phone)` e `createAppointment(body)`, com os tipos dos erros 409 (`slot_taken` com `slots`, `already_booked` com `appointment`).
- [X] T043 [US3] Criar `web/src/components/NewAppointment.tsx`, um formulário em etapas numa área da aba Appointments:
  1. **Phone**: ao sair do campo, `lookupPhone`. Preenche o nome. Mostra "This customer already has an appointment on …" e bloqueia o envio se houver `futureAppointment`.
  2. **Name**.
  3. **Service**: select com os 8 tratamentos e "General assessment".
  4. **Day**: botões com os dias de `bookingDays`.
  5. **Time**: botões com os horários de `bookingSlots`.
  6. **Book**: em `slot_taken`, mostra "That time was just taken. Pick another one." e recarrega os horários; em `calendar_disconnected`, mostra um aviso com link para `#/calendar`.

  Ao marcar, fecha o formulário e mostra "Booked for <dia hora>." na aba.
- [X] T044 [US3] Em `web/src/pages/Appointments.tsx`, adicionar o botão **New appointment** no topo, que abre e fecha `NewAppointment`. Em `web/src/styles.css`, estilos do formulário e dos botões de dia e horário, inclusive em 375px.

**Checkpoint**: US3 completa e testável sozinha ([quickstart.md](quickstart.md) §4).

---

## Phase 6: User Story 4 - Lembrete pelo WhatsApp 24 h antes, com confirmação (Priority: P2)

**Goal**: Quem está dentro da janela de 24 h recebe um lembrete único entre 24 h e 2 h antes do horário e confirma com YES. Os demais ficam "Remind manually", e o operador pode confirmar pelo painel.

**Independent Test**: Com os prazos encurtados no `.env`, marcar um horário, conversar com o assistente, receber o lembrete, responder YES e ver **Confirmed**. Com um número sem conversa recente, ver **Remind manually** e confirmar pelo painel ([quickstart.md](quickstart.md) §5).

### Tests for User Story 4

- [X] T045 [P] [US4] Em `src/modules/antiban/gate.test.ts`, testar `assistantBlockReason`:
  - para cada regra (`opted_out`, `paused`, `outside_window`, `daily_conversations`, `loop`, `unanswered`, `duplicate`), devolve o mesmo motivo que `sendAssistant` daria;
  - devolve `null` quando passaria;
  - não grava mensagem nem destaca a conversa.
- [X] T046 [P] [US4] Criar `src/modules/reminders/scheduler.test.ts` com relógio controlado, agenda falsa, PGlite e um portão falso que registra os envios:
  - antes da janela: nada;
  - na janela, com a janela do cliente aberta: um envio pelo `sendAssistant`, `reminder_status = sent` e registro "🔔 Reminder sent";
  - dois passos seguidos: um envio só;
  - `outside_window` e telefone sem conversa: `reminder_reason` gravado, sem envio e sem registro bloqueado no histórico;
  - `opted_out`: `not_sent` na hora;
  - `paused`: espera e envia quando a pausa acaba;
  - mensagem do cliente sem resposta ou sessão de agendamento aberta: espera;
  - evento apagado no Google: cancelado, sem lembrete;
  - evento movido: horário novo e lembrete recalculado;
  - faltando menos de 2 h: `not_sent` com o último motivo e registro no histórico;
  - confirmado pelo operador: nada;
  - variações de texto: duas conversas seguidas recebem textos diferentes se o primeiro estiver em `assistantTextsSince`.
- [X] T047 [P] [US4] Em `src/modules/scheduling/interpret.test.ts`, com `awaitingReminder: true` e sem etapa: `yes`, `confirmed`, `I'll be there` e `see you` dão `yes`; `no` dá `no`; `cancel my appointment` dá `cancel`. Com `awaitingReminder: false`, "yes" solto não vira `yes` pelas regras.
- [X] T048 [P] [US4] Em `src/modules/scheduling/router.test.ts`:
  - lembrete enviado + YES: grava `confirmed_by = customer`, registra no histórico e responde `reminderConfirmed`;
  - NO: abre `offer_reschedule`;
  - "cancel": segue para o fluxo;
  - com uma sessão de agendamento aberta, o YES vale para a sessão;
  - com mais de uma mensagem do cliente desde o lembrete, `awaitingReminder` fica desligado.
- [X] T049 [P] [US4] Em `src/modules/scheduling/replies.test.ts`, testar:
  - as 3 variações de `reminder` (com e sem nome; todas com dia, hora, serviço e "YES"; sem links);
  - `reminderConfirmed`;
  - os registros novos de [contracts/conversation.md](contracts/conversation.md).
- [X] T050 [P] [US4] Em `src/routes/panel-appointments.test.ts`, testar `POST /api/appointments/:id/confirm`:
  - grava `confirmed_by = operator`;
  - um lembrete `pending` vira `not_needed`;
  - confirmar duas vezes não muda nada;
  - 404 para id desconhecido ou horário passado;
  - publica `appointments.updated`.

### Implementation for User Story 4

- [X] T051 [US4] Em `src/modules/antiban/gate.ts`, adicionar `assistantBlockReason({ conversationId, phone, text }): Promise<BlockReason | null>`, que percorre o mesmo array `rules` na mesma ordem e não grava nada. `sendAssistant` passa a usar a mesma função interna para não duplicar a ordem das regras.
- [X] T052 [P] [US4] Em `src/modules/scheduling/replies.ts`, adicionar:
  - `replies.reminder(start, service, name, tz): string[]` (as 3 variações);
  - `replies.reminderConfirmed(start, name, tz)`;
  - `systemNotes.reminderSent`, `systemNotes.reminderNotSent(start, reasonText, tz)`, `systemNotes.confirmedByCustomer` e `systemNotes.confirmedByOperator`;

  conforme [contracts/conversation.md](contracts/conversation.md). Os textos dos motivos reaproveitam os de `web/src/components/MessageBubble.tsx`, copiados para um mapa no servidor, mais `no_conversation`.
- [X] T053 [P] [US4] Em `src/modules/scheduling/sessions.ts`, adicionar:
  - `dueReminders(until: Date)`: `booked` + `pending` com `startsAt <= until`;
  - `markReminderSent(id, at)`: só se ainda `pending` (devolve `false` se outro passo já marcou);
  - `setReminderReason(id, reason)`;
  - `markReminderNotSent(id, reason)`;
  - `confirm(id, by, at)`: grava a confirmação, e um lembrete `pending` vira `not_needed`;
  - `findReminderAwaiting(phone, now)`: o próximo horário `booked` do telefone com `sent` e sem confirmação.

  Incluir todos no embrulho que publica `appointments.updated` em `src/routes/scheduling.ts`.
- [X] T054 [US4] Criar `src/modules/reminders/scheduler.ts` com `createReminderScheduler({ store, calendar, connection, gate, inboxRepo, inbox, schedulingSessions, log, now, leadMinutes, cutoffMinutes, tickMs })` e os métodos `tick()`, `start()` e `stop()`. A cada `tick()`, com uma trava em memória contra dois passos simultâneos, para cada `dueReminders(now + lead)`:
  1. Pula se `startsAt − now > lead`.
  2. Se faltar menos de `cutoff`, chama `markReminderNotSent` com o último motivo (ou `too_late`) e registra `reminderNotSent` na conversa, se houver.
  3. Com a agenda conectada, confere o evento (`getEvent`): apagado → `markCancelled(…, "calendar")` + registro; movido → `updateTimes` com o status recalculado.
  4. Acha a conversa pelo telefone; sem ela, grava o motivo `no_conversation`.
  5. Espera, sem motivo novo, se houver mensagem do cliente sem resposta (`customerMessagesSinceLastReply`) ou sessão de agendamento ativa.
  6. Escolhe o texto com `gate.pickVariant(conversationId, replies.reminder(…))`.
  7. Chama `gate.assistantBlockReason`. `opted_out` → `markReminderNotSent`; outro motivo → `setReminderReason`; `null` → `gate.sendAssistant`. Em `sent`: `markReminderSent` + registro `reminderSent`. Em `blocked` ou `failed`: grava o motivo.
- [X] T055 [US4] Em `src/index.ts`, criar o agendador com as instâncias do processo e `env.REMINDER_*`, chamar `start()` depois do `app.listen` e `stop()` no SIGINT/SIGTERM. Erros de um passo vão para o log e não derrubam o processo.
- [X] T056 [US4] Em `src/modules/scheduling/interpret.ts`, adicionar `awaitingReminder?: boolean` ao `InterpretInput`. Nas regras, sem etapa e com `awaitingReminder`, `YES` (mais "confirmed", "i'll be there" e "see you") dá `yes` e `NO` dá `no`. No prompt do modelo, a linha do contrato. Em `validate`, aceitar `yes` e `no` sem etapa quando `awaitingReminder`.
- [X] T057 [US4] Em `src/modules/scheduling/router.ts`, sem sessão:
  1. Busca `store.findReminderAwaiting(conversation.phone, at)`.
  2. Liga `awaitingReminder` se houver e o cliente tiver mandado no máximo uma mensagem desde `reminderSentAt` (`inbox.customerMessagesSince`).
  3. Depois da interpretação:
     - `yes` → `store.confirm(id, "customer", at)` + registro `confirmedByCustomer` + resposta `replies.reminderConfirmed`;
     - `no` → `flow.handle` com a intenção `reschedule`, que oferece a remarcação pelo caminho existente (`offerReschedule`) ou responde `noAppointment`;
     - o resto segue como hoje.

  Ampliar o `Deps.store` com `findReminderAwaiting` e `confirm`, e ajustar `src/routes/evolution-webhook.ts`.
- [X] T058 [US4] Em `src/routes/panel-appointments.ts`, adicionar `POST /api/appointments/:id/confirm` (só horário futuro marcado). Com conversa no telefone, registra `systemNotes.confirmedByOperator`.
- [X] T059 [P] [US4] Em `web/src/api.ts`, adicionar `confirmAppointment(id)`. Em `web/src/pages/Appointments.tsx`:
  - botão **Confirm** nas linhas sem confirmação, em destaque nas `remind_manually`;
  - `title` da etiqueta com o motivo por extenso;
  - **Remind manually** em evidência (cor `--warn`).

**Checkpoint**: US4 completa ([quickstart.md](quickstart.md) §5).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T060 [P] Atualizar o `README.md`:
  - aba **Appointments**, marcação pelo painel, edição e anotações em **Customers**, lembrete (opção B: só dentro das 24 h, "Remind manually");
  - variáveis `REMINDER_*`;
  - os módulos novos (`reminders/`, `booking.ts`, `phone.ts`).
- [X] T061 [P] Adicionar avisos no topo de `specs/003-google-calendar-scheduling/contracts/google-calendar.md` (nova chamada `renameEvent`) e de `specs/005-customer-name-registry/contracts/panel-api.md` (`notes`, `conversationId` e `PATCH`), apontando para os contratos da 006.
- [X] T062 Rodar `npm run typecheck`, `npm test` e `npx tsx --env-file=.env scripts/eval-scheduling.ts` (23/23). Conferir o grep da convenção "Telefone" e abrir as abas Appointments, Customers e o formulário de marcação em 375px e em 1280px.
- [ ] T063 Validar ponta a ponta pelo [quickstart.md](quickstart.md) §2 a §5 com o WhatsApp real e os prazos encurtados, e depois voltar os prazos ao padrão. (Precisa do celular do operador e de um segundo número.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T002 depende de T001.
- **Foundational (Phase 2)**: depende da Phase 1 e bloqueia todas as histórias.
- **US1 (Phase 3)**: depende da Phase 2.
- **US2 (Phase 4)**: depende da Phase 2. É independente da US1, mas a anotação só aparece na aba Appointments depois da US1 (a ficha funciona sem ela).
- **US3 (Phase 5)**: depende da Phase 2. O formulário vive na aba Appointments, então a parte do painel (T043, T044) depende da US1. O servidor (T034 a T041) não depende.
- **US4 (Phase 6)**: depende da Phase 2. Os botões e etiquetas do painel (T059) dependem da US1. O agendador e o roteador não dependem.
- **Polish (Phase 7)**: depois das histórias escolhidas.

### User Story Dependencies

- **US1 (P1)**: só a Phase 2. É o MVP.
- **US2 (P1)**: só a Phase 2.
- **US3 (P2)**: a Phase 2, mais a US1 para a tela.
- **US4 (P2)**: a Phase 2, mais a US1 para a tela. Com a US3 pronta, horários marcados pelo painel também recebem lembrete, sem tarefa extra.

### Within Each User Story

- Testes antes da implementação, e falhando no início.
- Banco (sessions, repository) → serviços/módulos → rotas → painel.
- Uma tarefa sem [P] no mesmo arquivo de outra roda depois dela.

### Parallel Opportunities

- **Phase 1**: T003 em paralelo com T001/T002.
- **Phase 2**: T004, T005, T007, T010 e T011 em paralelo; T006 → T008 → T009 em sequência; T012 depois de T006.
- **US1**: T014, T015, T019 e T023 em paralelo.
- **US2**: T024 a T029 e T031 em paralelo (arquivos diferentes); T030 depois de T026 a T029.
- **US3**: T034 a T037 e T042 em paralelo; T038 → T039 → T040 → T041.
- **US4**: T045 a T050 em paralelo; T051, T052 e T053 em paralelo; T054 depois deles; T056 → T057.
- Com mais de uma pessoa: depois da Phase 2, US1 e US2 podem andar juntas, e o servidor da US3 e da US4 também.

---

## Parallel Example: User Story 4

```text
# Testes primeiro, todos em arquivos diferentes:
T045 gate.test.ts            — assistantBlockReason
T046 reminders/scheduler.test.ts
T047 interpret.test.ts       — awaitingReminder
T048 router.test.ts          — YES/NO ao lembrete
T049 replies.test.ts         — textos do lembrete
T050 panel-appointments.test.ts — confirmação pelo operador

# Depois, em paralelo:
T051 gate.ts   T052 replies.ts   T053 sessions.ts
# Em seguida: T054 scheduler.ts → T055 index.ts; T056 interpret.ts → T057 router.ts; T058; T059
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2. Daqui já sai a correção de os horários não sumirem ao apagar conversas.
2. Phase 3 (US1).
3. **Parar e validar** pelo quickstart §2. O dono já vê a agenda no painel.

### Incremental Delivery

1. Setup + Foundational.
2. US1: aba Appointments (MVP).
3. US2: ficha do cliente. É barata e corrige títulos errados na agenda.
4. US3: marcar pelo painel.
5. US4: lembrete. É a de maior ganho, mas a mais delicada (proteção do número e interpretação do YES).

Cada história é validável sozinha e pode virar um commit próprio.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- O lembrete nunca abre exceção à janela de 24 h (opção B, 2026-10-25). Se algum teste ou tarefa parecer exigir isso, pare e reveja a spec.
- O agendador e o fluxo podem mexer no mesmo horário ao mesmo tempo (cliente remarcando enquanto o lembrete sai). `markReminderSent` só grava se o status ainda for `pending`, e `updateTimes` recalcula o lembrete. Na pior hipótese, o cliente recebe o lembrete do horário que acabou de trocar, e a conversa registra os dois.
- Commitar por fase ou por história, sem linhas de coautoria.
