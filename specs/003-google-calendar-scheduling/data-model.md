# Data Model: Agendamento pelo Google Agenda

Mudanças no Postgres (`src/db/schema.ts`), em duas migrations geradas com `npm run db:generate`: `drizzle/0002_scheduling.sql` (cria) e `drizzle/0003_drop_legacy_google.sql` (remove as tabelas antigas, separada para o drizzle-kit não perguntar se as novas são renomeações delas):

- **Novas**: `calendar_connection`, `scheduling_rules`, `scheduling_sessions` e `appointments`, mais os enums `calendar_status`, `scheduling_step` e `appointment_status`.
- **Alteradas**: `conversations` ganha `needs_attention`, e o enum `message_origin` ganha `system`.
- **Removidas**: `google_accounts` e `users`, que nunca foram usadas ([research.md R7](research.md#r7-conexão-com-o-google-uma-agenda-da-clínica)).

Todas as datas são `timestamptz`, gravadas em UTC. O fuso da clínica é o da agenda escolhida (`calendar_connection.time_zone`) e só é aplicado ao calcular horários e escrever textos.

## calendar_connection

Uma linha só (`id = 1`). Sem linha, a agenda está desconectada.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | smallint PK, `check (id = 1)` | Garante a linha única |
| `email` | text, not null | E-mail da conta Google (`userinfo`) |
| `refresh_token_enc` | text, not null | Criptografado com `encrypt()` de `src/config/crypto.ts` (FR-005) |
| `scopes` | text, not null | Escopos concedidos, separados por espaço |
| `calendar_id` | text, not null | Agenda escolhida. Padrão: `primary` da conta (FR-002) |
| `calendar_name` | text, not null | Nome exibido no painel |
| `time_zone` | text, not null | Fuso IANA da agenda (ex.: `America/Bahia`), vindo do `calendarList` |
| `status` | enum `calendar_status`: `connected` \| `needs_reauth` | `needs_reauth` quando o Google recusa o refresh token (US3, cenário 6) |
| `connected_at` | timestamptz, not null | — |
| `updated_at` | timestamptz, not null | — |

**Transições**: sem linha → `connected` (callback do OAuth) → `needs_reauth` (`invalid_grant`) → `connected` (reconectar) → sem linha (desconectar, FR-004). Reconectar com outra conta substitui a linha, e a agenda escolhida volta para a principal da nova conta.

## scheduling_rules

Uma linha só (`id = 1`), criada com os padrões na primeira leitura (Assumptions, [research.md R11](research.md#r11-regras-de-atendimento)).

| Coluna | Tipo | Padrão | Validação |
|---|---|---|---|
| `id` | smallint PK, `check (id = 1)` | 1 | — |
| `weekly_hours` | jsonb, not null | Seg–sex `09:00–18:00` | Chaves `"1"`–`"7"` (1 = segunda); cada valor `{ start, end }` em `HH:mm`, `start < end`; dia ausente = sem atendimento; ao menos um dia |
| `slot_minutes` | integer, not null | 60 | 15–240, múltiplo de 5 |
| `min_notice_minutes` | integer, not null | 120 | 0–10080 |
| `max_days_ahead` | integer, not null | 30 | 1–180 |
| `cancel_notice_minutes` | integer, not null | 1440 | 0–10080 (FR-027) |
| `updated_at` | timestamptz, not null | now | — |

## scheduling_sessions

Estado do fluxo de agendamento de uma conversa ([research.md R4](research.md#r4-estado-da-conversa-de-agendamento)). No máximo uma por conversa. Apagada quando o fluxo termina, quando expira ou quando o assistente desiste.

| Coluna | Tipo | Regra |
|---|---|---|
| `conversation_id` | uuid PK, FK → conversations.id, `on delete cascade` | — |
| `flow` | text, not null | `book` \| `cancel` \| `reschedule` |
| `step` | enum `scheduling_step` | Ver a máquina de estados |
| `options` | jsonb, not null, default `[]` | Opções numeradas da última oferta: `[{ n: 1, kind: "day", date: "2026-10-21" }]` ou `[{ n: 1, kind: "slot", start: "<ISO>" }]` |
| `selected_start` | timestamptz, null | Horário escolhido, aguardando nome ou confirmação |
| `customer_name` | text, null | Nome confirmado para o evento |
| `appointment_id` | uuid, null, FK → appointments.id | Agendamento que está sendo cancelado ou remarcado |
| `misunderstood_count` | integer, not null, default 0 | Zera a cada resposta entendida. Ao chegar a 2, o assistente desiste (FR-024a) |
| `expires_at` | timestamptz, not null | Última interação + 30 min |
| `updated_at` | timestamptz, not null | — |

### Máquina de estados (`step`)

```text
                ┌──────────── cliente já tem horário futuro (FR-019) ────────────┐
                │                                                                ▼
book ──► choose_day ──► choose_slot ──► ask_name? ──► confirm_booking ──► (evento criado, sessão apagada)
              ▲              │                              │
              └── "other day"┘◄──── horário ocupado (FR-015) ┘

cancel ──► confirm_cancel ──► (evento apagado, sessão apagada)
reschedule ──► choose_day ──► choose_slot ──► confirm_reschedule ──► (evento movido, sessão apagada)
offer_reschedule ── "yes" ──► reschedule   |   "no" ──► (sessão apagada)
```

- `choose_day`: oferece até 6 dias com vaga, numerados, ou entra direto no dia se o cliente já disse qual.
- `choose_slot`: oferece até 6 horários do dia, numerados. "more" mostra os próximos 6 (FR-013).
- `ask_name`: só quando a conversa não tem `name` do WhatsApp (Edge Case).
- `confirm_*`: mostra o resumo e espera sim ou não (FR-014). O "sim" refaz a consulta à agenda dentro da trava ([research.md R9](research.md#r9-evitar-marcar-o-mesmo-horário-duas-vezes)).
- `offer_reschedule`: o cliente que já tem horário pediu outro (FR-019).
- Em qualquer etapa: intenção `question` responde pelo RAG e mantém a etapa. Intenção `stop` apaga a sessão.

## appointments

Agendamentos feitos pelo assistente (FR-018).

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `conversation_id` | uuid FK → conversations.id, `on delete cascade`, not null | O cliente é identificado pelo número da conversa |
| `google_event_id` | text, not null, unique | Id do evento criado |
| `calendar_id` | text, not null | Agenda em que o evento foi criado |
| `starts_at` | timestamptz, not null | Atualizado quando o evento é remarcado, por aqui ou no Google (FR-018a) |
| `ends_at` | timestamptz, not null | `starts_at + slot_minutes` da época |
| `customer_name` | text, not null | — |
| `status` | enum `appointment_status`: `booked` \| `cancelled` | — |
| `cancelled_by` | text, null | `customer` \| `calendar` (apagado direto no Google) |
| `created_at` | timestamptz, not null | — |
| `updated_at` | timestamptz, not null | — |

**Índices**:
- `appointments_booked_start_uq`: unique `(calendar_id, starts_at) where status = 'booked'` (SC-003).
- `appointments_conversation_idx`: `(conversation_id, starts_at desc)`.

**Transições**: `booked` → `cancelled` (cliente cancelou, ou o evento sumiu do Google). Remarcar mantém `booked` e muda `starts_at`/`ends_at`. Um agendamento passado continua `booked` e deixa de contar para FR-019, que considera só `starts_at > now()`.

**Regra de "fonte da verdade"** (FR-018a): antes de informar, cancelar, remarcar ou bloquear um pedido novo, o sistema faz `events.get`. Evento apagado → `cancelled` / `calendar`, com uma mensagem `system` no histórico. Evento movido → `starts_at` e `ends_at` passam a ser os do Google.

## Mudanças em tabelas existentes

### conversations

| Coluna | Tipo | Regra |
|---|---|---|
| `needs_attention` | boolean, not null, default false | `true` quando o assistente desiste (FR-024a); volta a `false` em `POST /read` ou ao reativar o assistente (FR-024b) |

### messages

- `message_origin` ganha `system`: registros de agendamento no histórico ([research.md R10](research.md#r10-registro-no-histórico-e-precisa-de-atendimento)), com `status = received`, `type = text` e `wa_message_id = null`. Não são enviadas ao WhatsApp, não contam como não lidas e não entram no contexto do modelo.
