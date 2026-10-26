# Contract: respostas do assistente no agendamento

> **Atualizado pela feature 005:** o resumo antes da confirmação passou a mostrar o serviço, e há textos novos (pedido de nome, lista de serviços). Ver [specs/005 contracts/conversation.md](../../005-customer-name-registry/contracts/conversation.md).

Textos enviados ao cliente pelo WhatsApp, em inglês (Assumptions). São modelos fixos no código (`src/modules/scheduling/replies.ts`), preenchidos com os dados da agenda ([research.md R1](../research.md#r1-como-o-modelo-local-conduz-o-agendamento)). Datas e horas são formatadas no fuso da clínica, por exemplo `Tue, Oct 21` e `10:00 AM`.

Os testes comparam com estes modelos. A redação pode mudar, desde que o conteúdo exigido em cada linha continue presente.

| Chave | Quando | Modelo |
|---|---|---|
| `offer_days` | Início do `book`/`reschedule`, ou "other day" | `Sure! These days have openings:\n1. Tue, Oct 21\n2. Wed, Oct 22\n…\nReply with the number of the day, or tell me another date.` |
| `offer_slots` | Dia escolhido | `Available times on Tue, Oct 21:\n1. 9:00 AM\n2. 10:00 AM\n…\nReply with the number of the time. Say "more" for more options or "other day" for another date.` |
| `day_full` | Dia sem atendimento ou sem vaga | `Sorry, there are no openings on Sun, Oct 26. The closest days with openings are:\n1. …` |
| `too_far` | Data além do limite | `I can only book up to {maxDaysAhead} days ahead, until {lastDate}. Here are the closest days:\n1. …` |
| `ask_name` | Sem nome na conversa | `What name should I put on the appointment?` |
| `confirm_booking` | Horário escolhido | `Please confirm your appointment:\n📅 Tue, Oct 21 at 10:00 AM ({slotMinutes} min)\n👤 {name}\nReply YES to confirm or NO to choose another time.` |
| `booked` | Evento criado | `You're booked! 📅 Tue, Oct 21 at 10:00 AM. See you at DentalSafe.` |
| `slot_taken` | Horário ocupado na confirmação (FR-015) | `Sorry, that time was just taken. The closest available times are:\n1. …` |
| `already_booked` | Já tem horário futuro (FR-019) | `You already have an appointment on Tue, Oct 21 at 10:00 AM. Would you like to reschedule it? (YES/NO)` |
| `my_appointment` | Pergunta pelo horário | `Your appointment is on Tue, Oct 21 at 10:00 AM.` ou `I couldn't find an appointment for this number.` |
| `confirm_cancel` | Pedido de cancelamento | `Cancel your appointment on Tue, Oct 21 at 10:00 AM? (YES/NO)` |
| `cancelled` | Evento apagado | `Your appointment on Tue, Oct 21 at 10:00 AM was cancelled.` |
| `confirm_reschedule` | Novo horário escolhido | `Move your appointment from Tue, Oct 21 at 10:00 AM to Thu, Oct 23 at 2:00 PM? (YES/NO)` |
| `rescheduled` | Evento movido | `Done! Your appointment is now on Thu, Oct 23 at 2:00 PM.` |
| `too_late_to_change` | Dentro do prazo (FR-027) | `Your appointment is in less than {cancelNotice}, so I can't change it here. Please contact the clinic directly.` |
| `no_appointment` | Cancelar/remarcar sem horário | `I couldn't find an appointment for this number.` |
| `stopped` | Cliente desistiu | `No problem. Let me know if you'd like to book later.` |
| `unclear` | 1ª resposta não entendida | `Sorry, I didn't get that. {repete a pergunta ou a lista da etapa}` |
| `handoff` | 2ª resposta não entendida (FR-024a) | `Sorry, I'm having trouble understanding. Someone from our team will continue with you here shortly.` |
| `calendar_unavailable` | Agenda desconectada, `needs_reauth` ou fora do ar (FR-022) | `Sorry, I can't book appointments right now. Please try again later or contact the clinic.` |
| `interpreter_unavailable` | Ollama fora do ar no meio de um fluxo | Igual ao `UNAVAILABLE_MESSAGE` da feature 001 |

## Registros no histórico (`origin = system`)

Gravados na conversa e mostrados no painel em português (FR-018):

- `📅 Agendado pelo assistente: ter, 21/10 às 10:00 (60 min)`
- `📅 Remarcado pelo assistente: ter, 21/10 10:00 → qui, 23/10 14:00`
- `📅 Cancelado pelo cliente: ter, 21/10 às 10:00`
- `📅 Cancelado na agenda: ter, 21/10 às 10:00` (evento apagado no Google, FR-018a)
- `⚠️ O assistente não entendeu o cliente e foi pausado nesta conversa`

## Evento no Google Agenda

- **Título**: `Avaliação — {name}`
- **Descrição**: `WhatsApp: +55 71 99999-9999\nMarcado pelo Secretaryfy.`
- **Duração**: `slotMinutes` das regras.
- **Propriedades privadas**: `secretaryfy_appointment = <appointments.id>`, `secretaryfy_phone = <phone>`.
- **Convidados**: nenhum (Assumptions: sem e-mail ao cliente).
