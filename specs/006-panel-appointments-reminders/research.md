# Research: Agendamentos no painel, ficha do cliente e lembrete pelo WhatsApp

Decisões da Fase 0. Cada uma resolve uma dúvida do plano a partir do código atual (features 003 a 005).

## R1. O agendamento deixa de depender da conversa

**Problema**: `appointments.conversation_id` é obrigatório e apaga em cascata. "Delete all conversations" (e a desconexão do número) apaga junto todos os agendamentos, o que quebra a aba de agendamentos, o lembrete e o edge case "horário cuja conversa foi apagada aparece normalmente". Além disso, um horário marcado pelo painel para quem nunca escreveu não tem conversa nenhuma.

**Decisão**:
- `appointments` ganha `phone` (preenchido na migration a partir de `conversations.phone`).
- `conversation_id` passa a ser opcional, com `ON DELETE SET NULL`.
- A regra "um horário futuro por número" e a busca do horário do cliente (`findFutureBooked`) passam a usar o telefone, não a conversa. Assim o assistente encontra pelo WhatsApp um horário marcado pelo painel (US3, cenário 7) e o de antes de uma limpeza de conversas.
- A conversa de um horário é achada pelo telefone na hora de mostrar (`conversations.phone` é único). `conversation_id` fica só como registro de onde o horário nasceu.

**Alternativas**: criar uma conversa vazia para cada marcação pelo painel (polui a lista de conversas e continua apagando em cascata); manter a cascata e avisar no botão de limpeza (contraria o edge case da spec e faz o lembrete sumir).

## R2. Um motor de marcação só, para o assistente e para o painel

**Decisão**: o trecho de `flow.ts` que cria o horário (`book`: trava, regra de um por número, nova consulta à ocupação, `createEvent`, `insertBooked`, desfazer o evento se o índice único recusar, cadastro do cliente, registro no histórico) sai para `src/modules/scheduling/booking.ts`, como `bookSlot({ phone, name, service, start, origin, conversationId })`. O retorno é uma união: `booked`, `slot_taken`, `already_booked` ou `calendar_unavailable`.
- O fluxo do WhatsApp passa a chamar `bookSlot` e transforma o retorno nas respostas de hoje.
- O painel chama o mesmo `bookSlot`. Os horários oferecidos no painel vêm das mesmas funções de `availability.ts` (`availableDays`, `slotsForDay`) com o mesmo `busy` do Google e as mesmas regras (FR-013, FR-014).
- Remarcar continua no fluxo (o painel não remarca nesta feature).

**Alternativas**: o painel chamar o fluxo do WhatsApp com uma interpretação fabricada (acopla o painel à máquina de estados e às respostas em inglês); duplicar a lógica no painel (dois lugares para a mesma regra de agenda).

## R3. Quando e como o lembrete sai

**Decisão**: um agendador no próprio processo Node, com um passo a cada 60 s (como o polling da conexão), sem fila externa.
- **Janela do lembrete**: de `starts_at − 24 h` até `starts_at − 2 h`. Antes dela o lembrete espera; depois dela, se não saiu, vira "não enviado" com o motivo (FR-023).
- **Horário marcado com menos de 24 h**: nasce com o lembrete "não necessário" (FR-020).
- **A cada passo**, para cada horário com lembrete pendente dentro da janela:
  1. Confere o evento no Google, como o fluxo já faz (`getEvent`): apagado → cancelado, sem lembrete; movido → horário novo e lembrete recalculado.
  2. Verifica se o lembrete pode sair agora (R4). Se não puder, guarda o motivo e tenta no próximo passo.
  3. Se puder, envia pelo `gate.sendAssistant` e marca como enviado.
- **Reinício do servidor**: o estado fica no banco, e o primeiro passo depois de subir retoma de onde parou. Um lembrete atrasado ainda sai se faltarem 2 h ou mais (spec, US4 cenário 8).
- **Um passo por vez**: uma trava em memória impede dois passos simultâneos; o processo é único (como a trava da agenda em `lock.ts`).

**Alternativas**: um `setTimeout` por horário (perde tudo num reinício); cron do sistema operacional (fora do processo, mais uma peça para instalar no Windows); disparar só quando o cliente escreve (não cobre o cliente que escreveu e ficou esperando com a janela aberta).

## R4. O lembrete e a proteção do número (opção B da spec)

**Decisão**: o lembrete é uma mensagem do assistente como outra qualquer: sai pelo `gate.sendAssistant` e passa por todas as regras da feature 004, inclusive `outside_window`. Para não encher o histórico com uma tentativa bloqueada a cada minuto, o agendador consulta antes, sem gravar nada, um novo `gate.assistantBlockReason({ conversationId, phone, text })`. Ele roda as mesmas regras, na mesma ordem, e devolve o primeiro motivo ou `null`. Só quando volta `null` o agendador chama `sendAssistant`.

Condições próprias do lembrete, verificadas antes das regras do portão:
- **Sem conversa para o telefone** (marcado pelo painel, nunca escreveu): motivo `no_conversation`, e o horário fica como "lembrar manualmente".
- **Mensagem do cliente ainda sem resposta, ou agendamento em andamento na conversa**: espera o próximo passo, sem motivo novo. O lembrete nunca passa na frente da resposta que o cliente está esperando, e não atrapalha um fluxo aberto.

**Motivos e o que o painel mostra**:

| Motivo | Situação no painel |
|---|---|
| `outside_window`, `no_conversation` | "Remind manually" (o cliente não escreve há mais de 24 h) |
| `opted_out` | "Not sent: customer opted out", definitivo na hora |
| `paused`, `daily_conversations`, `unanswered`, `loop`, `rate_limited` | "Waiting: …", tenta de novo até o prazo |
| Prazo vencido (menos de 2 h) | "Not sent" com o último motivo |

O texto tem 3 variações escolhidas com `gate.pickVariant`, para não repetir o mesmo texto (regra `duplicate`).

**Alternativas**: chamar `sendAssistant` direto e aceitar os registros bloqueados no histórico (um por minuto, por até 22 h); abrir uma exceção à janela (descartado pelo dono do produto na opção B).

## R5. A resposta YES ao lembrete

**Decisão**: o roteador sabe que a conversa está "esperando a resposta do lembrete" quando, sem agendamento em andamento, o próximo horário do telefone tem lembrete enviado, ainda não está confirmado e o cliente mandou no máximo uma mensagem desde o lembrete (o mesmo critério do `awaitingName` da feature 005). Nesse caso o interpretador recebe `awaitingReminder: true`:
- As regras aceitam `yes` e `no` sem etapa.
- O prompt do llama3 ganha a linha "The assistant reminded the customer of their appointment and asked them to reply YES to confirm."

Com a interpretação na mão, o roteador age assim:
- **`yes`**: marca `confirmed_at` e `confirmed_by = customer`, registra no histórico e responde com um agradecimento (texto fixo). Não abre fluxo.
- **`no`**: abre a etapa `offer_reschedule`, que já existe ("Would you like to reschedule it? (YES/NO)").
- **`cancel`, `reschedule`, `my_appointment`**: seguem para o fluxo como hoje (US4, cenário 3).
- **Qualquer outra coisa**: segue o caminho normal (folheto ou fluxo).

Com um agendamento em andamento, o YES vale para a pergunta aberta (edge case da spec), porque o roteador só liga `awaitingReminder` sem sessão.

**Alternativas**: uma sessão de agendamento `confirm_reminder` (a sessão vence em 30 min, e a resposta ao lembrete pode vir horas depois); aceitar YES a qualquer momento, enquanto houver lembrete sem confirmação (um "yes" solto dias depois confirmaria por engano).

## R6. Editar o nome do cliente

**Decisão**: `PATCH /api/customers/:id` com `name` e/ou `notes`. Ao trocar o nome:
1. Atualiza `customers.name`.
2. Atualiza `conversations.customer_name` da conversa do telefone, se houver, para o assistente e o painel usarem o nome novo (FR-007).
3. Para cada horário futuro marcado desse telefone: atualiza `appointments.customer_name` e renomeia o evento no Google (`renameEvent`, um `events.patch` só do `summary`) para `"<nome> — <serviço>"`.

Uma falha no Google não desfaz o nome. A resposta traz `calendarUpdated: false`, e o painel avisa (FR-008). O `CalendarGateway` ganha `renameEvent(eventId, summary)`, e a agenda falsa dos testes também.

**Alternativas**: trocar o nome só no cadastro (o título errado continua na agenda, que é o motivo do pedido); deixar o agendador renomear depois (o atraso confunde: o dono salva e a agenda continua com o nome velho).

## R7. Anotações

**Decisão**: `customers.notes` (texto, opcional, até 1.000 caracteres, validado na API). Aparecem na ficha e nas linhas da aba de agendamentos. Ficam fora de qualquer caminho que chegue ao assistente: não entram em `knownName`, no histórico mandado ao RAG nem no interpretador (FR-010). Notas ficam só no cadastro; quem não está no cadastro não tem notas.

## R8. Telefone digitado no painel

**Decisão**: `normalizePhone(input)`.
1. Mantém só os dígitos e tira os zeros à esquerda (o "0" de operadora).
2. Com 10 ou 11 dígitos, assume Brasil e acrescenta `55`.
3. Aceita o resultado com 12 a 15 dígitos.

Assim "(71) 99999-9999", "+55 71 99999-9999" e "5571999999999" viram o mesmo `5571999999999` que a Evolution usa (FR-018). Números com 9 depois do DDD e sem ele não são unificados: o WhatsApp já os trata como chaves diferentes e o resto do sistema também.

## R9. Painel: rotas, navegação e tempo real

**Decisões**:
- **Aba nova `#/appointments`** (Appointments), entre Conversations e Customers. O botão **New appointment** abre o formulário de marcação na própria aba.
- **Abrir uma conversa** é `#/?c=<conversationId>`: a página de conversas lê o parâmetro e seleciona a conversa. A aba de agendamentos e a ficha do cliente usam esse link.
- **Grupos (Today, Tomorrow, Next 7 days)** são calculados no servidor, no fuso da agenda conectada, e vêm prontos em cada item (`group`). O navegador do operador pode estar em outro fuso.
- **Tempo real**: um evento SSE novo, `appointments.updated`, sem corpo, publicado quando um horário é marcado, remarcado, cancelado ou confirmado, ou quando o lembrete muda de situação. A aba busca a lista de novo. Para não espalhar `publish` pelo fluxo, o `SchedulingStore` do processo é embrulhado (como o `customerRepo` da feature 005) e publica depois de cada método que muda `appointments`.
- **Confirmação pelo operador**: `POST /api/appointments/:id/confirm` grava `confirmed_by = operator`. Um lembrete ainda pendente vira "não necessário" (FR-022a).

## R10. Situação do lembrete no banco

**Decisão**: em `appointments`:
- `reminder_status`: enum `pending | sent | not_sent | not_needed`.
- `reminder_reason`: texto, o último motivo de espera ou de não envio.
- `reminder_sent_at`.
- `confirmed_at` e `confirmed_by` (`customer | operator`).
- `origin` (`assistant | panel`).

Remarcar devolve o lembrete a `pending` (ou `not_needed`, se o horário novo estiver a menos de 24 h) e limpa a confirmação. O horário novo tem o seu próprio lembrete (FR-025).

Horários marcados antes desta migration recebem `not_needed`. O lembrete só vale para os novos (Assumptions).
