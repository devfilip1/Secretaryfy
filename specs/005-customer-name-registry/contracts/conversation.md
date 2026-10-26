# Contract: textos ao cliente (delta da feature 005)

Textos fixos enviados pelo WhatsApp, em inglês, no módulo `src/modules/scheduling/replies.ts`. Completa o [contrato da feature 003](../../003-google-calendar-scheduling/contracts/conversation.md); o que não está aqui não muda.

## Pedido de nome (R2)

Enviado como **última mensagem** da primeira resposta do folheto a um número sem nome conhecido, uma única vez por conversa. Uma das variações, sem repetir a que o cliente recebeu há pouco:

- `By the way, may I have your name?`
- `By the way, what's your name?`
- `Before I forget, may I have your name?`

Exemplo (o cliente pergunta "How much is whitening?" na primeira mensagem):

```text
Teeth whitening costs $180–$450.
By the way, may I have your name?
```

## Nome recebido (R3)

Quando o cliente só diz o nome (`give_name`, sem agendamento em andamento):

- `Nice to meet you, {name}! How can I help you?`
- `Thanks, {name}! How can I help you today?`

Quando o nome vem junto de uma pergunta, não há texto próprio: o nome é gravado e a resposta é a do folheto.

## Escolha do serviço (etapa `choose_service`, R4)

```text
Which service is this appointment for?
1. Dental Cleaning
2. Teeth Whitening
3. Dental Filling
4. Root Canal Treatment
5. Dental Implants
6. Braces and Orthodontic Treatment
7. Tooth Extraction
8. Dental Veneers
9. Not sure — general assessment
Reply with the number or the name of the service.
```

Repetição depois de "não entendi": `Sorry, I didn't get that. ` + a mesma lista.

## Resumo antes da confirmação (substitui o da feature 003)

```text
Please confirm your appointment:
📅 Mon, Oct 26 at 1:00 PM (30 min)
👤 Maria Souza
🦷 Dental Cleaning
Reply YES to confirm, NO to choose another time, or tell me another service.
```

"Assessment" aparece como `🦷 General assessment`.

## Confirmação da marcação

Sem mudança no texto: `You're booked! 📅 Mon, Oct 26 at 1:00 PM. See you at DentalSafe.`

## Registro no histórico do painel (`system`, em português)

`📅 Agendado pelo assistente: seg, 26/10 às 13:00 (30 min) — Dental Cleaning`
