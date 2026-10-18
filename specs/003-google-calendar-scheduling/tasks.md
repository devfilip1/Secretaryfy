---

description: "Task list for 003-google-calendar-scheduling"
---

# Tasks: Agendamento pelo Google Agenda

**Input**: Design documents from `/specs/003-google-calendar-scheduling/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/panel-api.md](contracts/panel-api.md), [contracts/interpreter.md](contracts/interpreter.md), [contracts/conversation.md](contracts/conversation.md), [contracts/google-calendar.md](contracts/google-calendar.md), [quickstart.md](quickstart.md)

**Tests**: Incluídos para o servidor, como define o plano ([research.md R12](research.md#r12-como-medir-sc-002-a-sc-005-sem-outro-número)). Os testes `node:test` não usam rede: a agenda é a falsa `src/test/fake-calendar.ts`, o Ollama é um `fetch` falso e o banco é o `createTestDb()` (PGlite em memória, ou `DATABASE_URL_TEST`). O painel (`web/`) é validado por `tsc` e pelo [quickstart.md](quickstart.md). O modelo real é medido por `scripts/eval-scheduling.ts`.

**Organization**: Uma fase por user story. A **US3** (conectar a agenda e definir as regras) vem primeiro: a spec a coloca como pré-requisito das outras. Depois vêm US2 (consultar horários), US1 (marcar), US4 (registro no histórico) e US5 (cancelar e remarcar). A desistência por "não entendi" (FR-024a/b) entra na US1, porque acontece dentro do fluxo de marcar.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1–US5, conforme a [spec](spec.md)

## Path Conventions

- Servidor: `src/` (código e comentários em português, imports com sufixo `.js`, como no projeto)
- Painel: `web/` (SPA React; dependências no `package.json` da raiz)
- Testes do servidor: `src/**/*.test.ts`, rodados com `npm test`
- Textos ao cliente: em inglês, conforme [contracts/conversation.md](contracts/conversation.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependência, configuração e pré-requisitos externos.

- [X] T001 Instalar com versão exata: `npm install --save-exact luxon@3.7.2` e `npm install --save-exact -D @types/luxon@3.7.1`. Conferir com `npm ls luxon @types/luxon`.
- [X] T002 [P] Em `src/config/env.ts`, acrescentar `OLLAMA_URL: z.url().default("http://127.0.0.1:11434")`, `AGENT_MODEL: z.string().min(1).default("llama3")`, `AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(20000)` e `PANEL_URL: z.url().optional()`, com comentário de que sem `PANEL_URL` vale `PUBLIC_URL`. Em `.env.example`, criar a seção `# Agendamento (Google Agenda + Ollama)` com essas quatro variáveis e o exemplo `PANEL_URL=http://localhost:5173` para desenvolvimento. Em `src/test/setup-env.ts`, acrescentar `OLLAMA_URL: "http://ollama.test"`, `AGENT_MODEL: "test-model"` e `PANEL_URL: "http://panel.test"`.
- [X] T003 [P] Verificar o Ollama local: rodar uma chamada `POST http://127.0.0.1:11434/api/chat` com `model: "llama3"`, `stream: false` e `format` igual ao schema de [contracts/interpreter.md](contracts/interpreter.md#2-modelo-ollama), e conferir que a resposta é um JSON que obedece ao schema. Se não obedecer, registrar a diferença em `research.md` (R2) antes de seguir.
- [X] T004 [P] Conferir no Google Cloud Console os pré-requisitos do [quickstart.md](quickstart.md#pré-requisitos) (Calendar API ativada, redirect URI, escopos e usuário de teste). Se o acesso ao Console não estiver disponível, anotar no fim deste arquivo como pendência do operador e seguir: os testes não dependem disso. *(2026-10-18: sem acesso ao Console a partir daqui; fica como pendência do operador, ver Notes)*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Banco, datas, regras de atendimento, a interface da agenda e os tipos compartilhados. Toda story depende disto.

**⚠️ CRITICAL**: Nenhuma story começa antes desta fase.

### Tests for Foundational

- [X] T005 [P] Escrever `src/modules/scheduling/dates.test.ts` para `parseSimpleDate(text, { now, timeZone })` e as funções de formatação, com `now` fixo numa terça (2026-10-20 15:00 em `America/Bahia`):
  - `today`, `tomorrow`, `friday` (a próxima sexta), `next friday` (a da semana seguinte), `monday` quando hoje é segunda (a de hoje), `20/10`, `Oct 23`, `23 Oct` (sem ano: o próximo no futuro), `31/02` (null), `banana` (null).
  - `formatDay(date)` → `Tue, Oct 21`; `formatTime(date)` → `10:00 AM`; `formatPtBr(date)` → `ter, 21/10 às 10:00`, sempre no fuso informado.
- [X] T006 [P] Escrever `src/modules/scheduling/rules.test.ts` para o schema zod de [contracts/panel-api.md](contracts/panel-api.md#put-apicalendarrules): aceita os padrões; recusa `start >= end`, `slotMinutes` 10 ou 17, `slotMinutes` maior que a janela de um dia, `weeklyHours` vazio, chave `"8"`, `maxDaysAhead` 0 e `cancelNoticeMinutes` negativo, com `path` correto em cada erro.

### Implementation for Foundational

- [X] T007 Em `src/db/schema.ts`, conforme [data-model.md](data-model.md):
  - Remover `users` e `googleAccounts`.
  - Acrescentar os enums `calendarStatus` (`connected`, `needs_reauth`), `schedulingStep` (`choose_day`, `choose_slot`, `ask_name`, `confirm_booking`, `offer_reschedule`, `confirm_cancel`, `confirm_reschedule`) e `appointmentStatus` (`booked`, `cancelled`), e o valor `system` em `messageOrigin`.
  - Acrescentar as tabelas `calendarConnection`, `schedulingRules`, `schedulingSessions` e `appointments`, com os `check (id = 1)`, o índice único parcial `appointments_booked_start_uq` em `(calendar_id, starts_at) where status = 'booked'` e o índice `appointments_conversation_idx`.
  - Acrescentar `needsAttention` em `conversations`.
  - Exportar os tipos `CalendarConnectionRow`, `SchedulingRulesRow`, `SchedulingSessionRow` e `AppointmentRow`.
- [X] T008 Rodar `npm run db:generate` para criar `drizzle/0002_*.sql`. Conferir que a migration remove `google_accounts` e `users` e cria o índice parcial com `WHERE`. Se o Drizzle não gerar o `check`, acrescentar à mão no SQL. Em `src/test/db.ts`, incluir as tabelas novas no `truncate`. *(Gerado em duas migrations para evitar o prompt interativo de renomeação do drizzle-kit: `0002_scheduling.sql` cria e `0003_drop_legacy_google.sql` remove as tabelas antigas.)*
- [X] T009 [P] Criar `src/modules/scheduling/dates.ts` com Luxon: `parseSimpleDate`, `formatDay`, `formatTime` e `formatPtBr`, conforme [contracts/interpreter.md](contracts/interpreter.md#1-regras-sem-modelo) (faz T005 passar).
- [X] T010 [P] Criar `src/modules/scheduling/rules.ts`: `DEFAULT_RULES`, o schema zod `rulesSchema` (faz T006 passar), `getRules(db)`, que cria a linha com os padrões se não existir, `saveRules(db, rules)` e a conversão entre a linha do banco e o JSON `rules` do contrato.
- [X] T011 [P] Criar `src/modules/google/gateway.ts` com a interface `CalendarGateway` de [contracts/google-calendar.md](contracts/google-calendar.md) e os erros `CalendarUnavailable` e `CalendarAuthError`. Criar `src/test/fake-calendar.ts`: implementação em memória (eventos num `Map`, `busy` a partir dos eventos mais uma lista de bloqueios configurável, `failNext(error)` para simular falhas e um contador de chamadas por método).
- [X] T012 [P] Em `src/modules/inbox/events.ts`, acrescentar ao `InboxEvent` o tipo `{ type: "calendar.updated"; connection: CalendarConnectionJson }`. Definir `CalendarConnectionJson` em `src/modules/google/connection.ts` (só o tipo, por enquanto), conforme [contracts/panel-api.md](contracts/panel-api.md#get-apicalendar).
- [X] T013 [P] Em `src/modules/inbox/presenters.ts`, acrescentar `needsAttention` ao `ConversationJson` e a `presentConversation`. Ajustar `src/modules/inbox/presenters.test.ts`. Em `web/src/api.ts`, acrescentar `needsAttention` a `Conversation` e `"system"` à origem de `Message`.

**Checkpoint**: `npm test` e `npm run typecheck` verdes; `npm run db:migrate` aplica a 0002.

---

## Phase 3: User Story 3 - Operador conecta a agenda e define as regras (Priority: P1)

**Goal**: Pelo painel, o operador conecta a conta Google da clínica, escolhe a agenda, define as regras e vê o estado da conexão.

**Independent Test**: [quickstart.md §2](quickstart.md#2-conectar-a-agenda-e-definir-regras-us3-sc-007): conectar uma conta de teste, escolher a agenda, salvar regras e desconectar.

### Tests for User Story 3

- [X] T014 [P] [US3] Escrever `src/modules/google/oauth.test.ts`: `buildConnectUrl()` tem `access_type=offline`, `prompt=consent`, os 5 escopos de [contracts/google-calendar.md](contracts/google-calendar.md#oauth) e um `state` que `verifySigned` devolve como `"calendar-connect"`; `missingScopes("openid email .../calendar.events")` aponta os 2 que faltam.
- [X] T015 [P] [US3] Escrever `src/modules/google/connection.test.ts`, com `createTestDb()` e um `publish` falso: `save()` grava o token criptografado (nunca em texto puro na linha) e publica `calendar.updated`; `get()` sem linha devolve `disconnected`; `markNeedsReauth()` muda o status e publica; `remove()` apaga a linha e as `scheduling_sessions`.
- [X] T016 [P] [US3] Escrever `src/routes/panel-calendar.test.ts` com `app.inject` e um gateway falso: 401 sem sessão; `GET /api/calendar` desconectado e conectado; `POST /api/calendar/connect` devolve `url`; `GET /api/calendar/calendars` com e sem conexão (409); `PUT /api/calendar/selection` com agenda inválida (422); `PUT /api/calendar/rules` com regras inválidas (422 com `issues`) e válidas (200); `DELETE /api/calendar` (204, e revogar com falha não impede).
- [X] T017 [P] [US3] Escrever `src/routes/google-oauth.test.ts` com a troca do `code` falsa: `state` válido grava e redireciona para `http://panel.test/#/agenda?google=connected`; `error=access_denied` → `?google=denied` sem mudar a conexão existente; `state` inválido ou vencido → `?google=error`; escopo faltando → `?google=missing_scope` sem gravar.

### Implementation for User Story 3

- [X] T018 [US3] Reescrever `src/modules/google/oauth.ts` ([research.md R7](research.md#r7-conexão-com-o-google-uma-agenda-da-clínica)): `GOOGLE_SCOPES` com os 5 escopos; `buildConnectUrl()` com `state = sign("calendar-connect", 600)`; `exchangeCode(code)` devolvendo `{ refreshToken, scopes, email }`; `missingScopes(scopes)`; `revoke(refreshToken)`; e `authClientFor(refreshToken)`. Remover `buildConnectUrl(userId)`, `handleOAuthCallback` e `getAuthClientForUser` (faz T014 passar).
- [X] T019 [US3] Criar `src/modules/google/connection.ts`: `createConnectionStore({ db, publish })` com `get()`, `getForUse()` (a linha com o token descriptografado, ou `null`), `save({ email, refreshToken, scopes, calendar })`, `selectCalendar({ id, name, timeZone })`, `markNeedsReauth()` e `remove()`, publicando `calendar.updated` a cada mudança (faz T015 passar).
- [X] T020 [US3] Criar `src/modules/google/calendar.ts`: `createGoogleCalendar({ connection })`, que implementa `CalendarGateway` com `googleapis`, conforme a tabela de [contracts/google-calendar.md](contracts/google-calendar.md#chamadas): tempo limite de 10 s, `sendUpdates: "none"`, `invalid_grant`/401/403/404 da agenda → `connection.markNeedsReauth()` + `CalendarAuthError`, 429/5xx/rede → `CalendarUnavailable`, e `deleteEvent` sem erro em 404/410. Sem conexão, toda chamada lança `CalendarUnavailable`.
- [X] T021 [US3] Reescrever `src/routes/google-oauth.ts` conforme [contracts/panel-api.md](contracts/panel-api.md#get-authgooglecallback-pública-fora-de-api): valida o `state`, troca o `code`, confere os escopos, lista as agendas para achar a principal e o fuso, grava com `connection.save` e redireciona para `${PANEL_URL ?? PUBLIC_URL}/#/agenda?google=...`. Receber as dependências por parâmetro para o teste (faz T017 passar).
- [X] T022 [US3] Criar `src/routes/panel-calendar.ts` com `GET /api/calendar`, `POST /api/calendar/connect`, `GET /api/calendar/calendars`, `PUT /api/calendar/selection`, `PUT /api/calendar/rules` e `DELETE /api/calendar`, conforme [contracts/panel-api.md](contracts/panel-api.md). Os erros do gateway viram 409/502 (faz T016 passar).
- [X] T023 [US3] Em `src/index.ts`, criar o `connectionStore` e o gateway do Google e registrar `googleOAuthRoutes(deps)` e `panelCalendarRoutes(deps)`. Garantir que o refresh token não aparece no log.
- [X] T024 [P] [US3] Em `web/src/api.ts`, acrescentar os tipos `CalendarConnection`, `CalendarRules` e `CalendarOption` e as funções `getCalendar`, `connectCalendar`, `listCalendars`, `selectCalendar`, `saveRules` e `disconnectCalendar`. Em `web/src/App.tsx`, tratar `calendar.updated` vindo do SSE.
- [X] T025 [US3] Criar `web/src/pages/Calendar.tsx`:
  - **Conexão**: desconectada mostra "Conectar Google Agenda", que chama `connectCalendar()` e faz `window.location.href = url`. Conectada mostra a conta e um seletor da agenda. Com `needs_reauth`, mostra aviso e "Reconectar". Há "Desconectar", com confirmação.
  - **Regras**: um formulário com cada dia da semana (marcar, início, fim), duração, antecedência, dias à frente e prazo de cancelamento (os dois prazos em horas no formulário e em minutos na API), com os erros de `issues` ao lado de cada campo.
  - **Avisos**: lê `?google=connected|denied|error|missing_scope` do hash, mostra uma mensagem em português e limpa o parâmetro.
- [X] T026 [US3] Em `web/src/App.tsx`, acrescentar a rota `#/agenda` e o link "Agenda" no menu, ao lado de "Conexão". Em `web/src/styles.css`, acrescentar o estilo do formulário de regras (grade por dia) e dos avisos.

**Checkpoint**: Quickstart §2 passa: conectar, escolher a agenda, salvar regras, cancelar a autorização e desconectar.

---

## Phase 4: User Story 2 - Cliente pergunta dias e horários livres (Priority: P1)

**Goal**: O assistente responde no WhatsApp com os dias e horários livres, lidos na hora da agenda, em opções numeradas. As dúvidas sobre a clínica continuam no RAG.

**Independent Test**: [quickstart.md §4](quickstart.md#4-consultar-e-marcar-us1-us2), passos 1, 2, 7 e 8: um horário ocupado no Google não é oferecido; domingo não tem vaga; uma dúvida sobre preço continua respondida pelo folheto.

### Tests for User Story 2

- [X] T027 [P] [US2] Escrever `src/modules/scheduling/availability.test.ts` para `availableSlots(...)`, com regras e `now` fixos: os horários respeitam início, fim e duração (FR-009); a antecedência mínima corta os primeiros do dia; o limite de dias à frente; um busy de 10:00 a 12:00 remove 10:00 e 11:00; um busy de 10:30 a 10:45 remove 10:00 com slot de 60 min; um evento de dia inteiro remove o dia; um dia sem atendimento não tem horários; a troca de horário de verão num fuso que a tem (`America/Sao_Paulo` em 2018) não gera horário duplicado nem pulado. Também `availableDays(...)`: só dias com ao menos um horário.
- [X] T028 [P] [US2] Escrever `src/modules/scheduling/interpret.test.ts` com `fetch` falso:
  - As regras de [contracts/interpreter.md](contracts/interpreter.md#1-regras-sem-modelo) resolvem sem chamar o `fetch`: `"2"` com 3 opções → `choose`; `"7"` → `unclear`; `"yes"` em `confirm_booking`; `"tomorrow"` sem etapa → `availability` com a data.
  - O corpo enviado ao Ollama tem `format`, `temperature: 0`, a data de hoje, a etapa e as opções, e no máximo 20 mensagens de histórico.
  - Resposta do modelo válida → `source: "model"`; intenção fora da lista, `option` inexistente ou data inválida → `unclear`; data além do limite → marcada como `tooFar`, não como `unclear`.
  - `fetch` que falha ou estoura o tempo → `InterpreterUnavailable`.
- [X] T029 [P] [US2] Escrever `src/modules/scheduling/flow.test.ts`, parte de disponibilidade, com `createTestDb()`, `fake-calendar` e um interpretador falso que devolve intenções prontas: `availability` sem data → `offer_days` com até 6 dias numerados e sessão `choose_day`; `choose` do dia → `offer_slots` e sessão `choose_slot`; `more` → os próximos 6; dia sem vaga → `day_full` com os dias mais próximos; data além do limite → `too_far`; agenda desconectada ou `CalendarUnavailable` → `calendar_unavailable` sem quebrar; sessão vencida (`expires_at` no passado) é descartada.
- [X] T030 [P] [US2] Escrever `src/modules/scheduling/router.test.ts`: sem sessão, intenção `question` vai para o `ask` do RAG; com sessão, `question` vai para o RAG e a sessão continua; conversa pausada não interpreta nem responde; pausada entre interpretar e enviar → não envia; `InterpreterUnavailable` sem sessão → RAG; com sessão → `interpreter_unavailable`. Atualizar `src/modules/whatsapp/handle-message.test.ts` para o handler que delega ao router.

### Implementation for User Story 2

- [X] T031 [P] [US2] Criar `src/modules/scheduling/availability.ts` com `availableSlots({ rules, busy, now, timeZone, from, to })` e `availableDays(...)`, conforme [research.md R6](research.md#r6-cálculo-dos-horários-livres) (faz T027 passar).
- [X] T032 [P] [US2] Criar `src/modules/scheduling/ollama.ts`: `createOllamaClient({ url, model, timeoutMs, fetch })` com `chat({ messages, format })`, que chama `/api/chat` com `stream: false`, `keep_alive: "30m"` e `options.temperature: 0`, faz o parse do `message.content` como JSON e lança `InterpreterUnavailable` em erro de rede, tempo estourado, status diferente de 2xx ou conteúdo que não é JSON.
- [X] T033 [US2] Criar `src/modules/scheduling/interpret.ts`: `createInterpreter({ ollama })` com `interpret({ text, step, options, history, now, timeZone, rules })`, que aplica primeiro as regras (usando `dates.ts`), depois o modelo com o schema e as instruções de [contracts/interpreter.md](contracts/interpreter.md), e por fim a validação zod (faz T028 passar).
- [X] T034 [P] [US2] Criar `src/modules/scheduling/replies.ts` com uma função por chave de [contracts/conversation.md](contracts/conversation.md), recebendo dados já calculados (`Date`, fuso e número de opções) e devolvendo o texto. Nesta fase: `offerDays`, `offerSlots`, `dayFull`, `tooFar`, `unclear`, `calendarUnavailable` e `interpreterUnavailable`. Testar em `src/modules/scheduling/replies.test.ts` que as listas são numeradas a partir de 1 e que as datas saem no fuso da clínica.
- [X] T035 [US2] Criar `src/modules/scheduling/sessions.ts`: repositório de `scheduling_sessions` com `get(conversationId, now)` (apaga e devolve `null` quando vencida), `save(session)` (renova `expires_at` em +30 min) e `clear(conversationId)`.
- [X] T036 [US2] Criar `src/modules/scheduling/flow.ts` com `createSchedulingFlow({ db, calendar, connection, sessions, now })` e `handle({ conversation, interpretation, session })`, que devolve `{ reply: string }`. Nesta fase: intenções `availability` e `book` até `offer_slots` (`choose_day` → `choose_slot`, `more`, `other_day`, `day_full`, `too_far`), e `stop`. Agenda desconectada, `needs_reauth` ou `CalendarUnavailable` → `calendarUnavailable` (FR-022) (faz T029 passar).
- [X] T037 [US2] Em `src/modules/inbox/service.ts` e `repository.ts`, acrescentar `recentHistory(conversationId, limit = 20)`: as últimas mensagens de texto, sem as `system`, em ordem cronológica, mapeadas para `{ role: "user" | "assistant", content }`.
- [X] T038 [US2] Criar `src/modules/scheduling/router.ts`: `createSchedulingRouter({ interpreter, flow, sessions, rag, inbox, rules, connection, now })` com `handle({ conversationId, message }, log)`. Segue a tabela de [research.md R3](research.md#r3-quando-a-mensagem-vai-para-o-agendamento-ou-para-o-folheto), checa `isPaused` antes de interpretar e antes de enviar, e envia com `startOutgoing`/`finishOutgoing` (`origin = assistant`). Loga a intenção, a origem (`rule`/`model`) e a latência, sem o texto do cliente (faz T030 passar).
- [X] T039 [US2] Em `src/modules/whatsapp/handle-message.ts`, delegar mensagens de texto ao router, mantendo o `UNAVAILABLE_MESSAGE` da 001 como resposta quando o RAG falha. Em `src/routes/evolution-webhook.ts`, montar o interpretador (`env.OLLAMA_URL`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS`), o flow, as sessões e o router com o RAG e o inbox existentes.

**Checkpoint**: Pelo `simulate-customer` (T056) ou pelo comando da feature 002, perguntar "What times do you have tomorrow?" devolve a lista numerada sem os horários ocupados, e "How much are braces?" continua respondido pelo folheto.

---

## Phase 5: User Story 1 - Cliente marca um horário pelo WhatsApp (Priority: P1) 🎯 MVP

**Goal**: Do pedido à confirmação: o cliente escolhe dia e horário, confirma, e o evento é criado na agenda sem duplicidade. Inclui a regra de um horário por número e a desistência após 2 respostas não entendidas.

**Independent Test**: [quickstart.md §4](quickstart.md#4-consultar-e-marcar-us1-us2) passos 3 a 6 e [§6](quickstart.md#6-desistência-e-pausa-fr-024a-fr-023).

### Tests for User Story 1

- [X] T040 [P] [US1] Escrever `src/modules/scheduling/lock.test.ts`: duas chamadas simultâneas de `withCalendarLock` rodam uma depois da outra; um erro na primeira não trava a segunda.
- [X] T041 [P] [US1] Ampliar `src/modules/scheduling/flow.test.ts` com o fluxo de marcar:
  - `choose` do horário → `ask_name` quando a conversa não tem nome; com nome → `confirm_booking` com dia, hora, duração e nome (FR-014).
  - `yes` → `createEvent` chamado uma vez com título, descrição, duração e propriedades de [contracts/conversation.md](contracts/conversation.md#evento-no-google-agenda), linha `booked` em `appointments`, resposta `booked`, sessão apagada.
  - `no` → nenhum evento e volta para `choose_slot`.
  - O horário ocupado entre a oferta e o `yes` → nenhum evento, resposta `slot_taken` com novas opções (FR-015).
  - Dois `yes` simultâneos de conversas diferentes para o mesmo horário → só um evento e um `appointments` (SC-003).
  - `createEvent` falha → resposta `calendarUnavailable` e nenhum `booked` (FR-024).
  - Com um `booked` futuro na conversa, `book` → `already_booked` sem nova oferta (FR-019); o evento sumido do Google (`getEvent` null) → `appointments` vira `cancelled`/`calendar` e o fluxo segue normal (FR-018a).
  - 1ª resposta `unclear` → `unclear` com a pergunta repetida e `misunderstood_count = 1`; a 2ª → `handoff`, assistente pausado, `needs_attention = true`, sessão apagada (FR-024a); uma resposta entendida no meio zera o contador.
- [X] T042 [P] [US1] Ampliar `src/modules/inbox/service.test.ts`: `markRead` e `setAssistantPaused(id, false)` zeram `needsAttention` e publicam `conversation.updated`; `flagNeedsAttention(id)` pausa e marca na mesma transação.

### Implementation for User Story 1

- [X] T043 [P] [US1] Criar `src/modules/scheduling/lock.ts` com `withCalendarLock(fn)`, uma fila de promessas do processo ([research.md R9](research.md#r9-evitar-marcar-o-mesmo-horário-duas-vezes)) (faz T040 passar).
- [X] T044 [US1] Em `src/modules/scheduling/sessions.ts`, acrescentar o repositório de `appointments`: `insertBooked(...)` (tratando a violação do índice único como "horário ocupado"), `findFutureBooked(conversationId, now)`, `markCancelled(id, by)` e `updateTimes(id, start, end)`. Acrescentar `syncWithCalendar(appointment, calendar)`, que aplica [data-model.md](data-model.md#appointments) ("fonte da verdade", FR-018a) e devolve o agendamento atualizado ou `null` quando foi apagado.
- [X] T045 [US1] Em `src/modules/scheduling/replies.ts`, acrescentar `askName`, `confirmBooking`, `booked`, `slotTaken`, `alreadyBooked`, `stopped` e `handoff`.
- [X] T046 [US1] Em `src/modules/scheduling/flow.ts`, completar o `book`: `choose_slot` → `ask_name` (quando não há `conversation.name`) → `confirm_booking` → dentro de `withCalendarLock`: `busy` só do horário, `findFutureBooked` + `syncWithCalendar` (FR-019), `createEvent`, `insertBooked` e só então a resposta `booked`. Se o horário estiver ocupado, `slot_taken` com os horários livres mais próximos do mesmo dia (ou `offer_days`). `book` com horário futuro existente → `already_booked` com sessão `offer_reschedule` (o "yes" é tratado na US5; até lá, responde `stopped`) (faz parte de T041 passar).
- [X] T047 [US1] Em `src/modules/inbox/repository.ts` e `service.ts`, acrescentar `needsAttention`: `flagNeedsAttention(conversationId)` (pausa + marca, numa transação, e publica) e zerar a marca em `markRead` e em `setAssistantPaused(id, false)` (faz T042 passar).
- [X] T048 [US1] Em `src/modules/scheduling/flow.ts` e `router.ts`, implementar a desistência: `unclear` incrementa `misunderstood_count` e responde `unclear` com a pergunta da etapa; ao chegar a 2, `flagNeedsAttention`, sessão apagada e resposta `handoff`; qualquer interpretação válida zera o contador. Uma data além do limite não conta (contracts/interpreter.md §3) (completa T041).
- [X] T049 [P] [US1] Em `web/src/components/ConversationList.tsx`, destacar as conversas com `needsAttention` (selo "Precisa de atendimento" e borda de alerta) e, em `web/src/components/ConversationView.tsx`, mostrar o mesmo aviso no cabeçalho. Estilos em `web/src/styles.css`.

**Checkpoint**: MVP completo: marcar pelo WhatsApp de ponta a ponta (quickstart §4 e §6).

---

## Phase 6: User Story 4 - Operador acompanha os agendamentos (Priority: P2)

**Goal**: O histórico da conversa no painel mostra cada marcação, e o evento no Google identifica o cliente e a origem.

**Independent Test**: [quickstart.md §4](quickstart.md#4-consultar-e-marcar-us1-us2) passo 6: o painel mostra `📅 Agendado pelo assistente…` e o evento tem nome, WhatsApp e "Marcado pelo Secretaryfy".

### Tests for User Story 4

- [X] T050 [P] [US4] Ampliar `src/modules/inbox/service.test.ts`: `recordSystem(conversationId, text)` grava `origin = system`, `status = received` e `wa_message_id = null`, publica `message.created`, não soma em `unreadCount` e não aparece em `recentHistory`. Ampliar `flow.test.ts`: marcar grava `📅 Agendado pelo assistente: …` em `pt-BR`; o handoff grava o aviso `⚠️ …`.

### Implementation for User Story 4

- [X] T051 [US4] Em `src/modules/inbox/service.ts` e `repository.ts`, implementar `recordSystem(conversationId, text)` sem mexer em `last_message_at` nem na prévia. Em `src/modules/scheduling/flow.ts`, chamá-lo depois de marcar e no handoff, com os textos de [contracts/conversation.md](contracts/conversation.md#registros-no-histórico-origin--system) (faz T050 passar).
- [X] T052 [P] [US4] Em `web/src/components/MessageBubble.tsx`, mostrar `origin === "system"` como uma linha centralizada, sem balão nem remetente, com o horário. Estilo em `web/src/styles.css`.

**Checkpoint**: Os registros aparecem no painel em tempo real, sem recarregar.

---

## Phase 7: User Story 5 - Cliente cancela ou remarca o horário (Priority: P3)

**Goal**: O cliente cancela, remarca ou pergunta pelo seu horário pelo WhatsApp, respeitando o prazo do operador, com o Google Agenda como fonte da verdade.

**Independent Test**: [quickstart.md §5](quickstart.md#5-um-horário-por-número-cancelar-e-remarcar-us5).

### Tests for User Story 5

- [X] T053 [P] [US5] Ampliar `src/modules/scheduling/flow.test.ts`:
  - `my_appointment` → horário atual (o do Google, se movido) ou `no_appointment`.
  - `cancel` → `confirm_cancel`; `yes` → `deleteEvent`, `cancelled`/`customer`, resposta `cancelled` e registro `system`.
  - `reschedule` → `offer_days` → `offer_slots` → `confirm_reschedule` com o horário antigo e o novo; `yes` → `moveEvent` dentro da trava, `updateTimes`, resposta `rescheduled` e registro `system`.
  - O `yes` em `offer_reschedule` entra no `reschedule`.
  - Dentro de `cancel_notice_minutes` → `too_late_to_change` sem chamar a agenda (FR-027).
  - Sem horário → `no_appointment`.
  - O evento apagado no Google antes do `yes` → `no_appointment` e registro `📅 Cancelado na agenda…`.

### Implementation for User Story 5

- [X] T054 [US5] Em `src/modules/scheduling/replies.ts`, acrescentar `myAppointment`, `noAppointment`, `confirmCancel`, `cancelled`, `confirmReschedule`, `rescheduled` e `tooLateToChange`.
- [X] T055 [US5] Em `src/modules/scheduling/flow.ts`, implementar os fluxos `my_appointment`, `cancel` e `reschedule` e o `yes`/`no` de `offer_reschedule`, sempre com `syncWithCalendar` antes de usar o agendamento, `withCalendarLock` para apagar ou mover e a verificação do prazo (FR-026, FR-027). Gravar os registros `system` de cancelamento, remarcação e "cancelado na agenda" (faz T053 passar).

**Checkpoint**: Quickstart §5 passa por inteiro.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Ferramentas de validação sem um segundo número, documentação e a verificação final.

- [X] T056 [P] Criar `scripts/simulate-customer.ts`: lê `EVOLUTION_WEBHOOK_TOKEN` e `PORT` do ambiente, descobre o número conectado (`GET /instance/fetchInstances` na Evolution, ou `--phone`) e faz `POST /webhooks/evolution` com um `messages.upsert` de `fromMe: false`, `id` único e o texto do argumento. Imprime o status da resposta.
- [X] T057 [P] Criar `scripts/fixtures/scheduling-scenarios.json` com 20 conversas roteirizadas (mensagens do cliente, `now` fixo, eventos já ocupados e o resultado esperado: dia e hora marcados, ou nenhum). Cobrir números, datas relativas ("next Friday", "tomorrow afternoon"), troca de ideia, `no` na confirmação, perguntas no meio, cancelamento e remarcação.
- [X] T058 Criar `scripts/eval-scheduling.ts`: roda cada cenário com o interpretador real (`OLLAMA_URL`/`AGENT_MODEL`), o `fake-calendar` e um banco PGlite, e imprime por cenário e no total: acerto do horário (SC-005), horários oferecidos fora da regra (SC-002), eventos duplicados (SC-003), eventos sem confirmação (SC-004) e a latência de cada resposta (máxima e p95, SC-008). Sai com código 1 se alguma meta falhar.
- [X] T059 [P] Em `README.md`, acrescentar a seção "Agendamento pelo Google Agenda": o passo a passo do Cloud Console, conectar pelo painel, as regras padrão, as variáveis novas, como testar com `simulate-customer` e como rodar `eval-scheduling` (incluindo a troca de `AGENT_MODEL`).
- [X] T060 Rodar `npm test`, `npm run typecheck` e `npm run build`. Corrigir o que falhar.
- [X] T061 Rodar `scripts/eval-scheduling.ts` com `llama3`. Se o acerto ficar abaixo de 90% (SC-005), ajustar as instruções do interpretador ou as regras de [contracts/interpreter.md](contracts/interpreter.md) e rodar de novo. Registrar o resultado final (acerto, p95) em `research.md` (R2). *(2026-10-18: 18/20 na primeira rodada; com as regras de horário citado e de data citada na frase, 20/20, p95 0,9 s. Registrado em research.md R2.)*
- [ ] T062 Executar o [quickstart.md](quickstart.md) §1–§7 com a conta Google de teste e o WhatsApp conectado, e marcar aqui o que passou e o que ficou pendente. *(2026-10-18: §1 feito (install, `db:migrate` aplicado no banco de desenvolvimento, `npm test` 178/178). §2–§7 pendentes: dependem do Google Cloud Console (T004) e de rodar o servidor com o WhatsApp conectado, o que só o operador deve fazer — com o servidor no ar, o assistente responde os contatos reais do número.)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T003 e T004 não bloqueiam o código.
- **Foundational (Phase 2)**: depende do T001 e do T002. Bloqueia todas as stories.
- **US3 (Phase 3)**: depende da Foundational. É pré-requisito funcional das outras stories (sem agenda conectada não há o que consultar), mas os testes delas usam o `fake-calendar` e podem andar em paralelo.
- **US2 (Phase 4)**: depende da Foundational. Para validar de ponta a ponta, depende da US3.
- **US1 (Phase 5)**: depende da US2 (flow, router, interpretador e sessões).
- **US4 (Phase 6)**: depende da US1 (os registros acompanham a marcação).
- **US5 (Phase 7)**: depende da US1 (appointments, trava e `syncWithCalendar`).
- **Polish (Phase 8)**: T056 pode começar junto com a US2. T057 e T058 dependem da US1 (e da US5, para os cenários de cancelar e remarcar). O resto vem no fim.

### Within Each User Story

- Testes primeiro: escritos para falhar e depois atendidos.
- Funções puras (`dates`, `availability`, `replies`) antes do `flow`; `flow` antes do `router`; `router` antes do webhook.
- Servidor antes do painel na mesma story.

### Parallel Opportunities

- Setup: T002, T003 e T004.
- Foundational: T005, T006 e, depois do T007/T008, T009–T013.
- US3: T014–T017 juntos; T024 em paralelo com T018–T023.
- US2: T027–T030 juntos; T031, T032 e T034 juntos.
- US1: T040–T042 juntos; T043 e T049 em paralelo com o resto.
- Polish: T056, T057 e T059.

---

## Parallel Example: User Story 2

```bash
# Testes da US2 juntos:
Task: "availability.test.ts em src/modules/scheduling/"
Task: "interpret.test.ts em src/modules/scheduling/"
Task: "flow.test.ts (disponibilidade) em src/modules/scheduling/"
Task: "router.test.ts em src/modules/scheduling/"

# Peças independentes da US2 juntas:
Task: "availability.ts em src/modules/scheduling/"
Task: "ollama.ts em src/modules/scheduling/"
Task: "replies.ts em src/modules/scheduling/"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 e Phase 2.
2. Phase 3 (US3): agenda conectada e regras no painel.
3. Phase 4 (US2): consultar horários pelo WhatsApp.
4. Phase 5 (US1): marcar. **PARAR e VALIDAR** com quickstart §2, §4 e §6 e rodar o `eval-scheduling` (T058) para conferir o acerto do `llama3` antes de seguir.

### Incremental Delivery

1. US3 → o operador já conecta e configura.
2. + US2 → o cliente já consulta vagas (sem marcar).
3. + US1 → o cliente marca. Este é o MVP.
4. + US4 → o operador acompanha no histórico.
5. + US5 → o cliente cancela e remarca.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Rodar `npm test` ao fim de cada tarefa que mexe no servidor.
- O token do Google, o texto das mensagens do cliente e o `state` do OAuth não vão para o log.
- Commit ao fim de cada fase, quando o operador pedir.

## Pendências do operador

- **T004**: configurar no Google Cloud Console a Calendar API, a redirect URI `http://localhost:3000/auth/google/callback`, os escopos e o usuário de teste ([quickstart.md](quickstart.md#pré-requisitos)). Sem isso, a conexão real da agenda não funciona; os testes automáticos não dependem disso.
