# Implementation Plan: Agendamento pelo Google Agenda

**Branch**: `003-google-calendar-scheduling` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-google-calendar-scheduling/spec.md`

## Summary

O plano tem cinco partes:

- **Conexão com o Google**: o OAuth que já existe deixa de ser por cliente e passa a ser de uma agenda só, da clínica, conectada pelo painel. Os escopos agora são só de agenda, e o refresh token fica criptografado na tabela `calendar_connection`.
- **Disponibilidade**: os horários livres são calculados por uma função pura, a partir das regras de atendimento e da ocupação lida do `freebusy` na hora da pergunta.
- **Fluxo de agendamento**: uma máquina de estados determinística, guardada em `scheduling_sessions`, conduz marcar, consultar, cancelar e remarcar com opções numeradas. O `llama3` local só interpreta a mensagem, com saída restrita por JSON Schema. Todos os textos ao cliente são modelos fixos, e ele só ouve "booked" depois de o evento existir.
- **Segurança da agenda**: uma trava no processo, a nova consulta à agenda antes de gravar e um índice único em `appointments` impedem dois agendamentos no mesmo horário. O Google Agenda é a fonte da verdade.
- **Painel**: uma página **Agenda** (conexão, escolha da agenda e regras), os registros `system` no histórico e o destaque de "precisa de atendimento".

As dúvidas sobre a clínica continuam indo para o RAG da feature 001, sem mudança. Decisões em [research.md](research.md).

## Technical Context

**Language/Version**: Node 24 + TypeScript 7 (servidor e painel). O `rag/` em Python não muda.

**Primary Dependencies**:
- Já existentes: Fastify 5, Drizzle ORM com `postgres`, zod, `googleapis@186.0.0`, React 19 + Vite 8.
- Novas: `luxon@3.7.2` e `@types/luxon@3.7.1` (dev), com versão exata e publicadas há mais de duas semanas.
- Serviço local: Ollama 0.40.5 com `llama3` (já instalado), chamado direto pela `/api/chat`.

**Storage**: Postgres, migrations `drizzle/0002_scheduling.sql` e `drizzle/0003_drop_legacy_google.sql`:
- Novas tabelas: `calendar_connection`, `scheduling_rules`, `scheduling_sessions` e `appointments`.
- `conversations` ganha a coluna `needs_attention`, e o enum `message_origin` ganha o valor `system`.
- `users` e `google_accounts` são removidas.

Ver [data-model.md](data-model.md).

**Testing**:
- `node:test` sem rede: `availability`, parser de datas e números, interpretador com Ollama falso, máquina de estados com agenda falsa (`CalendarGateway`), trava contra duplicidade, rotas `/api/calendar*` e callback do OAuth.
- Testes de repositório no Postgres quando `DATABASE_URL_TEST` estiver definida.
- `scripts/eval-scheduling.ts` com o modelo real para SC-002 a SC-005 e SC-008.
- Ponta a ponta pelo [quickstart.md](quickstart.md), com `scripts/simulate-customer.ts`.

**Target Platform**: Desenvolvimento local no Windows 11; Google Calendar API v3 e Ollama local.

**Project Type**: Web application já existente: servidor Fastify em `src/` e SPA em `web/`.

**Performance Goals**:
- Resposta a um pedido de horários em até 30 s (SC-008). Orçamento: interpretação ≤ 20 s (`AGENT_TIMEOUT_MS`), Google ≤ 10 s por chamada, e o modelo fica carregado com `keep_alive: 30m`.
- Marcar em até 6 mensagens do cliente (SC-001): pedido → dia → horário → (nome) → sim.

**Constraints**:
- Só modelo local, sem custo por mensagem (FR-025).
- Nenhum evento sem confirmação explícita, e nenhum "booked" sem evento criado (SC-004).
- Zero duplicidade (SC-003).
- O webhook continua respondendo 200 na hora, e a pausa da feature 002 é respeitada antes de interpretar e de novo antes de enviar.
- O refresh token nunca vai para o log.

**Scale/Scope**: Uma clínica, uma agenda, um processo Node e algumas dezenas de conversas por dia.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `.specify/memory/constitution.md` continua sendo o template. Valem como gates as regras já praticadas nas features 001 e 002:

| Regra | Situação |
|---|---|
| Variáveis de ambiente validadas com zod em `src/config/env.ts` | ✅ `OLLAMA_URL`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS` e `PANEL_URL`, todas com padrão |
| Mudanças no banco por migration gerada pelo Drizzle | ✅ `drizzle/0002_*.sql` |
| Webhook responde antes de processar | ✅ O roteador de agendamento roda no mesmo segundo plano do handler atual |
| O comportamento do assistente em `rag/` não muda | ✅ `rag/` não é alterado. Dúvidas continuam indo para `/answer`, e o Ollama é chamado direto pelo Node só para interpretar |
| Segredos fora do código e do log | ✅ Refresh token criptografado com `crypto.ts` e fora do log. O `state` do OAuth é assinado e expira em 10 min |
| Código e comentários de `src/` em português | ✅ Os textos ao cliente continuam em inglês, como na 001 |
| Dependências com versão exata e publicadas há mais de 2 semanas | ✅ `luxon@3.7.2`, `@types/luxon@3.7.1` |

**Pós-Fase 1**: sem violações. Continua valendo a recomendação de rodar `/speckit-constitution` para registrar essas regras.

## Project Structure

### Documentation (this feature)

```text
specs/003-google-calendar-scheduling/
├── plan.md
├── research.md            # R1–R12
├── data-model.md          # tabelas, máquina de estados, transições
├── quickstart.md          # roteiro §1–§8, sem segundo número
├── contracts/
│   ├── panel-api.md       # /api/calendar*, callback do OAuth, SSE
│   ├── interpreter.md     # regras + Ollama com saída estruturada
│   ├── conversation.md    # textos ao cliente, registros no histórico, formato do evento
│   └── google-calendar.md # chamadas, escopos e erros
├── checklists/requirements.md
└── tasks.md               # gerado pelo /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── config/env.ts                       # + OLLAMA_URL, AGENT_MODEL, AGENT_TIMEOUT_MS, PANEL_URL
├── db/schema.ts                        # + calendar_connection, scheduling_rules, scheduling_sessions, appointments,
│                                       #   needs_attention, origin "system"; − users, google_accounts
├── index.ts                            # registra as rotas da agenda
├── modules/
│   ├── google/
│   │   ├── oauth.ts                    # REESCRITO: escopos de agenda, URL com state, troca do code, revogação
│   │   ├── connection.ts               # NOVO: leitura/gravação de calendar_connection, needs_reauth, evento SSE
│   │   ├── calendar.ts                 # NOVO: CalendarGateway com googleapis (contracts/google-calendar.md)
│   │   └── *.test.ts
│   ├── scheduling/                     # NOVO
│   │   ├── rules.ts                    # leitura com padrões, validação zod
│   │   ├── availability.ts             # função pura de horários livres (R6)
│   │   ├── dates.ts                    # parser de datas simples e formatação no fuso
│   │   ├── interpret.ts                # regras + Ollama + validação (contracts/interpreter.md)
│   │   ├── ollama.ts                   # cliente /api/chat com format e timeout
│   │   ├── replies.ts                  # textos ao cliente (contracts/conversation.md)
│   │   ├── sessions.ts                 # repositório de scheduling_sessions e appointments
│   │   ├── flow.ts                     # máquina de estados: book, cancel, reschedule, handoff
│   │   ├── lock.ts                     # withCalendarLock (R9)
│   │   ├── router.ts                   # agendamento ou RAG (R3)
│   │   └── *.test.ts
│   ├── inbox/
│   │   ├── service.ts                  # + recordSystem(), needsAttention em markRead/setAssistantPaused, recentHistory()
│   │   ├── repository.ts               # + consultas correspondentes
│   │   ├── presenters.ts               # + needsAttention, origin system
│   │   └── events.ts                   # + calendar.updated
│   └── whatsapp/handle-message.ts      # passa a delegar ao scheduling/router (o RAG vira uma dependência dele)
├── routes/
│   ├── google-oauth.ts                 # callback: state "calendar-connect", redireciona para PANEL_URL
│   ├── panel-calendar.ts               # NOVO: /api/calendar, /connect, /calendars, /selection, /rules
│   └── evolution-webhook.ts            # monta o handler com o router
└── test/setup-env.ts                   # + variáveis novas

web/src/
├── App.tsx                             # + rota #/agenda e link no menu
├── api.ts                              # + funções da agenda, needsAttention, origin system
├── pages/Calendar.tsx                  # NOVO: conexão, escolha da agenda, formulário de regras, avisos ?google=
├── components/
│   ├── ConversationList.tsx            # destaque "precisa de atendimento"
│   └── MessageBubble.tsx               # registro system centralizado
└── styles.css

scripts/
├── simulate-customer.ts                # NOVO: mensagem de cliente pelo webhook com o próprio número
├── eval-scheduling.ts                  # NOVO: 20 conversas com o modelo real e agenda falsa
└── fixtures/scheduling-scenarios.json  # NOVO
package.json                            # + luxon, @types/luxon
.env.example                            # + PANEL_URL, OLLAMA_URL, AGENT_MODEL, AGENT_TIMEOUT_MS
README.md                               # + seção Google Agenda (Cloud Console, conexão, avaliação)
```

**Structure Decision**: O agendamento fica num módulo próprio, `src/modules/scheduling/`, que depende de duas interfaces: `CalendarGateway` (Google) e `Interpreter` (Ollama). Assim a máquina de estados é testada inteira sem rede. O `handle-message` da feature 001 passa a chamar o `router`, que decide entre o fluxo e o RAG. A pausa, o registro das respostas e a regra de eco continuam no inbox da feature 002. As rotas só traduzem HTTP.

## Implementation Notes

- **Ordem sugerida**:
  1. Schema, migration e `rules`/`availability`/`dates`, com testes (base de US2).
  2. OAuth reescrito, `connection`, `calendar` e rotas `/api/calendar*` (US3).
  3. Página Agenda no painel (US3).
  4. `ollama`, `interpret` e `replies` (US1/US2).
  5. `flow` (book, availability), `lock` e `router` ligados ao `handle-message` (US1, US2).
  6. Registros `system` no inbox e no painel (US4).
  7. `cancel`, `reschedule` e `offer_reschedule` (US5).
  8. Handoff e `needsAttention` (FR-024a/b).
  9. `simulate-customer`, `eval-scheduling`, README e quickstart.
- **Pausa**: o `router` checa `isPaused` antes de interpretar e de novo antes de enviar, como o handler atual. Se a conversa foi pausada no meio, um evento criado continua criado (está correto na agenda), mas a confirmação não é enviada, e fica o registro `system` para o operador.
- **Handoff**: `setAssistantPaused(true)` + `needs_attention = true` + registro `system` + sessão apagada, numa transação, e depois o envio de `handoff`.
- **Mensagens enviadas pelo fluxo**: usam `startOutgoing`/`finishOutgoing` com `origin = assistant`, como as respostas do RAG, para o eco e o histórico funcionarem igual.
- **Expiração da sessão**: verificada na leitura (`expires_at < now` → apaga e trata a mensagem como sem etapa). Não precisa de job.
- **Fuso**: todo cálculo usa `calendar_connection.time_zone`. Os textos ao cliente mostram a hora no fuso da clínica, sem sufixo, e os registros no painel usam `pt-BR`.
- **Migração do OAuth**: `buildConnectUrl(userId)` e `getAuthClientForUser(userId)` deixam de existir. Como nenhuma rota os usava, não há dado a migrar.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Máquina de estados própria em vez de um agente com ferramentas | Modelo local de 8B sem tool calling (FR-025) e as garantias de SC-002 a SC-004 | Um agente com tool calling deixaria a corretude da agenda nas mãos do modelo ([research.md R1](research.md#r1-como-o-modelo-local-conduz-o-agendamento)) |
| Dependência nova (`luxon`) | Fuso e horário de verão no cálculo de horários | `Intl` à mão é propenso a erro, e `Temporal` ainda exige flag no Node 24 ([research.md R6](research.md#r6-cálculo-dos-horários-livres)) |
