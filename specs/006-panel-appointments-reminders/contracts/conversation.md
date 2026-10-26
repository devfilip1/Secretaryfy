# Contract: lembrete, resposta ao lembrete e registros no histórico

Textos ao cliente em inglês, fixos no código (`src/modules/scheduling/replies.ts`), como os da feature 003. Datas e horas no fuso da clínica (`Wed, Oct 21 at 10:00 AM`). Os testes comparam com estes modelos; a redação pode mudar, desde que o conteúdo exigido continue presente.

## Lembrete (`reminder`)

Uma mensagem só, com 3 variações, escolhidas por `gate.pickVariant` para nunca repetir o último texto enviado à conversa (regra `duplicate`, feature 004). Tem de conter o nome conhecido do cliente (se houver), o dia e a hora, o serviço e o pedido de YES.

1. `Hi {name}! Just a reminder of your appointment at DentalSafe on {Wed, Oct 21 at 10:00 AM} ({service}). Please reply YES to confirm.`
2. `Hello {name}, your {service} appointment at DentalSafe is on {Wed, Oct 21 at 10:00 AM}. Can you confirm you'll be there? Reply YES to confirm.`
3. `Hi {name}, this is DentalSafe reminding you of your appointment on {Wed, Oct 21 at 10:00 AM} for {service}. Reply YES to confirm, or tell me if you need to reschedule.`

Sem nome conhecido, a saudação fica sem ele (`Hi! …`, `Hello, …`). O texto não tem links.

## Respostas ao lembrete

| Chave | Quando | Modelo |
|---|---|---|
| `reminderConfirmed` | O cliente respondeu YES | `Thank you{, name}! Your appointment on {Wed, Oct 21 at 10:00 AM} is confirmed. See you at DentalSafe.` |
| `already_booked` (existente) | O cliente respondeu NO | Reaproveita a pergunta de remarcação da feature 003: `You have an appointment on … Would you like to reschedule it? (YES/NO)` |

Pedidos de cancelar ou remarcar seguem os textos da feature 003.

## Interpretador

`InterpretInput` ganha `awaitingReminder: boolean`. O roteador o liga (research.md R5) quando:
- não há agendamento em andamento na conversa;
- o próximo horário do telefone tem `reminder_status = sent` e não está confirmado;
- o cliente mandou no máximo uma mensagem desde `reminder_sent_at`.

Com `awaitingReminder`:
- **Regras**: as palavras de `YES` e `NO` (as mesmas das confirmações) devolvem `yes` e `no` sem etapa. "Confirmed", "I'll be there" e "see you" também contam como `yes`.
- **Modelo**: o prompt ganha `The assistant reminded the customer of their appointment and asked them to reply YES to confirm.`
- **Intenções que continuam valendo**: `cancel`, `reschedule`, `my_appointment` e `question`.

## Registros no histórico (`origin = system`, em inglês, como o painel)

- `🔔 Reminder sent for {Wed, Oct 21 at 10:00 AM}`. O texto do lembrete em si aparece como mensagem do assistente.
- `✅ Appointment confirmed by the customer: {Wed, Oct 21 at 10:00 AM}`
- `✅ Appointment confirmed by the operator: {Wed, Oct 21 at 10:00 AM}`
- `🔔 Reminder not sent for {Wed, Oct 21 at 10:00 AM}: {motivo}`. Gravado uma vez, quando o lembrete vira `not_sent`, e só se houver conversa para o telefone.
- `📅 Booked from the panel: {Wed, Oct 21 at 10:00 AM} (60 min) — {service}`. Só se houver conversa para o telefone.

Os motivos no histórico usam os mesmos textos dos bloqueios do painel (`the customer has not written in over 24 h`, `the customer asked not to receive messages`, …), mais `no WhatsApp conversation with this number`.
