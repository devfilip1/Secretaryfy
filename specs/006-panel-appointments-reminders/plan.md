# Implementation Plan: Agendamentos no painel, ficha do cliente e lembrete pelo WhatsApp

**Branch**: `006-panel-appointments-reminders` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-panel-appointments-reminders/spec.md`

## Summary

O plano tem cinco partes, no servidor (`src/`) e no painel (`web/`):

- **Agendamento independente da conversa** (pré-requisito de tudo). `appointments` ganha `phone`, e `conversation_id` vira opcional com `SET NULL`, no lugar da cascata. A regra "um horário por número" e a busca do horário do cliente passam a usar o telefone. Assim, apagar conversas não apaga mais horários, e o assistente acha pelo WhatsApp um horário marcado pelo painel (R1).
- **Aba Appointments** (US1). `GET /api/appointments` devolve os horários dos próximos 7 dias, já agrupados no fuso da clínica, com notas, conversa achada pelo telefone e situação do lembrete. O SSE `appointments.updated` sai de um `SchedulingStore` embrulhado (R9).
- **Ficha do cliente** (US2). `PATCH /api/customers/:id` troca o nome e as anotações. A troca de nome atualiza a conversa, os horários futuros e o título dos eventos no Google por um novo `renameEvent` (R6, R7). Na ficha, **View conversation** usa `#/?c=<id>`.
- **Marcar pelo painel** (US3). O trecho de criação do horário sai do `flow.ts` para `booking.ts` (`bookSlot`), usado pelo assistente e pelo painel. O painel oferece os horários com as mesmas funções de `availability.ts` (R2). O telefone digitado é normalizado (R8).
- **Lembrete** (US4). Um agendador no processo, com um passo a cada 60 s, percorre os horários com lembrete pendente entre 24 h e 2 h antes. Antes de enviar, ele:
  - confere o evento no Google;
  - pergunta ao portão anti-ban, sem gravar, se o envio passaria (`assistantBlockReason`);
  - só então envia pelo `sendAssistant`.

  Fora da janela de 24 h do cliente, o horário fica "Remind manually" (opção B da spec). O roteador reconhece a resposta YES/NO ao lembrete com `awaitingReminder` (R3 a R5, R10).

O RAG em Python não muda. Decisões em [research.md](research.md).

## Technical Context

**Language/Version**: Node 24 + TypeScript 7 (servidor e painel). O `rag/` não muda.

**Primary Dependencies**: as já existentes (Fastify 5, Drizzle ORM com `postgres`, zod, `googleapis`, luxon, React 19 + Vite 8; Ollama `llama3` no interpretador). Nenhuma dependência nova.

**Storage**: Postgres, migration `drizzle/0006_appointments_panel.sql`:
- `appointments`:
  - `conversation_id` passa a ser opcional, com `SET NULL`;
  - colunas novas `phone`, `origin`, `reminder_status` (enum novo), `reminder_reason`, `reminder_sent_at`, `confirmed_at` e `confirmed_by`;
  - dois índices novos;
  - os registros existentes recebem `phone` da conversa e `reminder_status = not_needed`.
- `customers.notes`.

Ver [data-model.md](data-model.md).

**Configuração nova** (`src/config/env.ts`, com padrão):
- `REMINDER_LEAD_MINUTES=1440`;
- `REMINDER_CUTOFF_MINUTES=120`;
- `REMINDER_TICK_MS=60000`.

Servem só para testar com prazos curtos ([quickstart.md](quickstart.md)).

**Testing**: `node:test` sem rede, no padrão atual (PGlite, agenda falsa, Ollama falso, portão com `TEST_ANTIBAN`).
- **`booking.ts`**:
  - cria evento e agendamento;
  - regra de um por telefone;
  - horário tomado (pela ocupação e pelo índice único, desfazendo o evento);
  - agenda fora do ar;
  - cadastro do cliente;
  - lembrete inicial `pending`/`not_needed`.
- **`flow.ts`**: os testes atuais continuam passando com `bookSlot` e a busca por telefone, mais um horário de outra conversa com o mesmo telefone.
- **Agendador**:
  - janela de 24 h e prazo de 2 h;
  - evento apagado ou movido no Google;
  - `outside_window` e `no_conversation` (lembrar manualmente);
  - `opted_out` (definitivo);
  - pausa e espera;
  - mensagem do cliente sem resposta;
  - sessão aberta;
  - variações de texto;
  - um único envio mesmo com passos repetidos;
  - confirmação do operador antes do lembrete;
  - remarcação.
- **Roteador**: `awaitingReminder` com YES (confirma), NO (`offer_reschedule`), cancel, uma pergunta qualquer, e YES no meio de uma sessão (vale para a sessão).
- **Gate**: `assistantBlockReason` devolve o mesmo motivo que `sendAssistant` daria e não grava nada.
- **Rotas**:
  - `GET /api/appointments` (grupos e situação do lembrete);
  - `POST /api/appointments` (201, 409 nas três variações, 422);
  - `/api/booking/*` (dias, horários, lookup com telefone normalizado);
  - `POST /api/appointments/:id/confirm`;
  - `PATCH /api/customers/:id` (nome, notas, `calendarUpdated: false` com o Google falhando).
- **Repositórios**:
  - `DELETE /api/conversations` preserva `appointments`;
  - `normalizePhone`.
- `scripts/eval-scheduling.ts` continua 23/23.
- Ponta a ponta pelo [quickstart.md](quickstart.md).

**Target Platform**: Desenvolvimento local no Windows 11; Evolution API, Google Calendar API v3 e Ollama como hoje.

**Project Type**: Web application já existente: servidor Fastify em `src/` e SPA React em `web/`.

**Performance Goals**:
- A aba Appointments abre em menos de 1 s, sem chamada ao Google na listagem: a lista vem do banco, e o Google é conferido pelo agendador e pelo fluxo.
- O passo do agendador não chama o Google para quem está fora da janela do lembrete.
- No máximo um `getEvent` por horário e por passo dentro da janela.

**Constraints**:
- Nenhuma mensagem fora da janela de 24 h do cliente (feature 004 FR-001, opção B da spec).
- Todo envio passa pelo portão (feature 004), e o lembrete conta nos limites.
- Um lembrete por horário (SC-006): `reminder_status` muda para `sent` na mesma transação que confirma o envio, e o passo do agendador não roda duas vezes ao mesmo tempo.
- Marcar pelo painel usa a mesma trava (`withCalendarLock`) e a mesma conferência que o assistente (FR-014).
- Textos ao cliente em inglês; telas e registros do painel em inglês; código e comentários em português.

**Scale/Scope**: Uma clínica, um processo Node, dezenas de horários por semana.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `.specify/memory/constitution.md` continua sendo o template. Valem como gates as regras praticadas nas features 001 a 005:

| Regra | Situação |
|---|---|
| Mudanças no banco por migration gerada pelo Drizzle | ✅ `0006_appointments_panel.sql`; o preenchimento de `phone` vai como SQL extra na mesma migration |
| Webhook responde antes de processar | ✅ O webhook não muda; o agendador roda à parte |
| Todo envio passa pela proteção do número (004), sem exceção à janela de 24 h | ✅ O lembrete sai pelo `sendAssistant`; a consulta prévia usa as mesmas regras (R4) |
| O modelo só interpreta; textos e decisões do agendamento são do código (003) | ✅ Lembrete, agradecimento e registros são textos fixos; YES/NO por regras, o modelo só como reserva |
| O Google Agenda é a fonte da verdade (003) | ✅ O agendador confere o evento antes do lembrete; a marcação pelo painel confere a ocupação dentro da trava |
| Uma regra de agenda num lugar só | ✅ `bookSlot` e `availability.ts` servem o assistente e o painel (R2) |
| Dependências com versão exata e publicadas há mais de 2 semanas | ✅ Nenhuma dependência nova |

**Pós-Fase 1**: sem violações. A mudança de `conversation_id` para `SET NULL` é a correção de um comportamento que contrariava a spec (R1), não uma exceção. Continua valendo a recomendação de rodar `/speckit-constitution` para registrar essas regras.

## Project Structure

### Documentation (this feature)

```text
specs/006-panel-appointments-reminders/
├── plan.md              # Este arquivo
├── research.md          # Fase 0: decisões R1 a R10
├── data-model.md        # Fase 1: colunas novas, transições do lembrete, situação no painel
├── quickstart.md        # Fase 1: roteiro de validação
├── contracts/
│   ├── panel-api.md         # /api/appointments, /api/booking/*, PATCH /api/customers/:id, SSE, navegação
│   ├── conversation.md      # Lembrete, resposta ao lembrete, awaitingReminder, registros no histórico
│   └── google-calendar.md   # renameEvent
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
drizzle/
└── 0006_appointments_panel.sql            # novo (gerado + preenchimento de phone)

src/
├── config/env.ts                          # REMINDER_LEAD_MINUTES, REMINDER_CUTOFF_MINUTES, REMINDER_TICK_MS
├── db/schema.ts                           # appointments (phone, origin, lembrete, confirmação; FK SET NULL); customers.notes
├── modules/
│   ├── antiban/gate.ts                    # assistantBlockReason (as mesmas regras, sem gravar)
│   ├── customers/repository.ts            # update(name, notes); list com notes
│   ├── google/
│   │   ├── gateway.ts                     # renameEvent
│   │   └── calendar.ts                    # events.patch do summary
│   ├── inbox/repository.ts                # findConversationByPhone; setCustomerNameByPhone
│   ├── reminders/
│   │   ├── scheduler.ts                   # novo: passo do agendador (janela, sync, consulta ao portão, envio)
│   │   └── status.ts                      # novo: situação mostrada no painel (label) a partir das colunas
│   ├── scheduling/
│   │   ├── booking.ts                     # novo: bookSlot, compartilhado pelo fluxo e pelo painel
│   │   ├── phone.ts                       # novo: normalizePhone
│   │   ├── flow.ts                        # usa bookSlot; busca por telefone; remarcar recalcula o lembrete
│   │   ├── sessions.ts                    # findFutureBooked(phone); insertBooked com phone/origin/lembrete; lista da aba;
│   │   │                                  #   confirm; marcações do lembrete; renomear horários futuros
│   │   ├── interpret.ts                   # awaitingReminder (regras YES/NO e linha no prompt)
│   │   ├── router.ts                      # awaitingReminder; YES confirma; NO → offer_reschedule
│   │   └── replies.ts                     # reminder (3 variações), reminderConfirmed, registros novos
│   └── whatsapp/handle-message.ts         # sem mudança de contrato
├── routes/
│   ├── scheduling.ts                      # novo: store compartilhado e embrulhado (publica appointments.updated), bookSlot
│   ├── panel-appointments.ts              # novo: /api/appointments, /api/booking/*, confirm
│   ├── panel-customers.ts                 # PATCH /api/customers/:id; notes e conversationId na lista
│   └── evolution-webhook.ts               # usa o store e o bookSlot compartilhados
├── index.ts                               # registra as rotas novas; liga e desliga o agendador
└── test/fake-calendar.ts                  # renameEvent

web/src/
├── api.ts                                 # tipos e chamadas de agendamentos, booking, PATCH de cliente
├── useEvents.ts                           # appointments.updated
├── App.tsx                                # aba Appointments (#/appointments)
├── pages/
│   ├── Appointments.tsx                   # novo: grupos, situação do lembrete, Confirm, abrir conversa, New appointment
│   ├── Customers.tsx                      # editar nome, Notes, View conversation
│   └── Inbox.tsx                          # abre a conversa de #/?c=<id>
├── components/NewAppointment.tsx          # novo: telefone → lookup, nome, serviço, dia, horário, confirmar
└── styles.css                             # estilos da aba e do formulário (com a seção de celular)
```

Testes ao lado de cada módulo (`*.test.ts`), como no resto do projeto.

**Structure Decision**: segue a estrutura existente, com um módulo por domínio em `src/modules/*`. O lembrete vira um módulo próprio, `src/modules/reminders/`: ele não pertence ao agendamento (não responde ao cliente, roda sozinho) nem à proteção (usa o portão como qualquer outro remetente). `booking.ts` fica em `scheduling/` porque é a parte do agendamento que o painel reaproveita. As instâncias do processo (store embrulhado, `bookSlot`) saem do `evolution-webhook.ts` para `routes/scheduling.ts`, como já acontece com `routes/inbox.ts` e `routes/calendar.ts`, porque agora são usadas também pelas rotas do painel e pelo agendador.

## Complexity Tracking

Sem violações a justificar.
