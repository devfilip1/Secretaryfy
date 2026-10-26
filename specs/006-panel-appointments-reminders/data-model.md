# Data Model: Agendamentos no painel, ficha do cliente e lembrete pelo WhatsApp

Migration `drizzle/0006_appointments_panel.sql`, gerada pelo Drizzle a partir de `src/db/schema.ts`, com um ajuste manual para preencher `appointments.phone` nos registros existentes.

## appointments (alterada)

| Coluna | Tipo | Mudança | Regra |
|---|---|---|---|
| `conversation_id` | uuid | passa a ser **opcional**; FK `ON DELETE SET NULL` (era `CASCADE`) | Onde o horário nasceu; apagar conversas não apaga agendamentos (R1) |
| `phone` | text, not null | **nova** | Telefone do cliente no formato do WhatsApp (`5571999999999`). Preenchida na migration com `conversations.phone` |
| `origin` | text, not null, default `'assistant'` | **nova** | `assistant` (WhatsApp) ou `panel` |
| `reminder_status` | enum `reminder_status`, not null, default `'not_needed'` | **nova** | `pending`, `sent`, `not_sent` ou `not_needed` (R10) |
| `reminder_reason` | text | **nova** | Último motivo de espera ou de não envio (R4) |
| `reminder_sent_at` | timestamptz | **nova** | |
| `confirmed_at` | timestamptz | **nova** | O cliente respondeu YES ou o operador confirmou |
| `confirmed_by` | text | **nova** | `customer` ou `operator` |

Colunas que continuam: `id`, `google_event_id`, `calendar_id`, `starts_at`, `ends_at`, `customer_name`, `service`, `customer_id`, `status`, `cancelled_by`, `created_at`, `updated_at`.

**Índices**:
- Continua o `appointments_booked_start_uq` (um horário marcado por início na agenda).
- Novo `appointments_phone_idx` em `(phone, starts_at)`, para a regra de um horário futuro por número e a busca do cliente.
- Novo `appointments_reminder_idx` em `(reminder_status, starts_at)`, para o agendador.

**Migration dos registros existentes**:
- `phone` vem da conversa.
- `reminder_status = 'not_needed'`: o lembrete só vale para os horários novos.
- `origin = 'assistant'`.

### Lembrete: transições

```text
marcado (≥ 24 h antes) ──► pending ──(janela aberta, regras ok)──► sent ──(YES)──► confirmado
marcado (< 24 h antes) ──► not_needed
pending ──(operador confirma)──► not_needed (+ confirmed_by = operator)
pending ──(faltam < 2 h)──► not_sent (reason = último motivo)
pending ──(cliente pediu para sair)──► not_sent (reason = opted_out)
qualquer ──(remarcado)──► pending ou not_needed (confirmação limpa)
qualquer ──(cancelado / apagado no Google)──► sem lembrete (status do agendamento = cancelled)
```

`confirmed_at` é independente de `reminder_status`: um horário pode ter o lembrete enviado e estar confirmado, ou não.

### Situação mostrada no painel

Derivada de `reminder_status`, `reminder_reason`, `confirmed_by` e do horário. O servidor manda pronta em `reminder.label`.

| Situação | Quando |
|---|---|
| `confirmed` | `confirmed_at` preenchido |
| `scheduled` | `pending`, ainda antes de `starts_at − 24 h` |
| `remind_manually` | `pending` dentro da janela, com motivo `outside_window` ou `no_conversation` |
| `waiting` | `pending` dentro da janela, com outro motivo (pausa, limites) |
| `sent` | `sent` e sem confirmação |
| `not_sent` | `not_sent` (com o motivo) |
| `not_needed` | `not_needed` e sem confirmação |

## customers (alterada)

| Coluna | Tipo | Mudança | Regra |
|---|---|---|---|
| `notes` | text | **nova** | Anotações livres da clínica, até 1.000 caracteres (validado na API). Nunca chega ao assistente (R7) |

`name` passa a poder ser editado pelo painel (não vazio, até 120 caracteres, sem espaços nas pontas). `phone` continua não editável.

## Entidades sem tabela

- **Item da aba de agendamentos**: um agendamento `booked` com `starts_at` entre agora e o fim do 7º dia seguinte (no fuso da agenda), mais:
  - `group`: `today`, `tomorrow` ou `week`;
  - a conversa achada pelo telefone (`conversationId` ou `null`);
  - as notas do cliente (pelo `customer_id` ou pelo telefone);
  - a situação do lembrete e da confirmação.
- **Marcação pelo painel**: `phone` (normalizado, R8), `name`, `service` (catálogo da feature 005) e `start` (um dos horários livres oferecidos). Vira um agendamento com `origin = 'panel'` pelo mesmo `bookSlot` do WhatsApp (R2).

## Mudanças de comportamento nos módulos existentes

- **`SchedulingStore.findFutureBooked(phone, now)`**: passa a buscar pelo telefone (era pela conversa). Os chamadores do fluxo passam `conversation.phone`.
- **`SchedulingStore.insertBooked`**: recebe `phone`, `origin`, `conversationId | null` e o `reminder_status` inicial (`pending` ou `not_needed`, conforme a antecedência).
- **`SchedulingStore.updateTimes`**: ao remarcar, recalcula `reminder_status`, limpa `reminder_reason`, `reminder_sent_at`, `confirmed_at` e `confirmed_by`. Uma variação para a sincronização com o Google faz o mesmo quando o evento foi movido lá.
- **`InboxService.clearAll`**: inalterado. Com a FK `SET NULL`, os agendamentos ficam.
