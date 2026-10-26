# Quickstart: validar a feature 006

## 1. Preparar

```powershell
npm run db:migrate          # aplica drizzle/0006_appointments_panel.sql
npm run typecheck
npm test
npm run dev                 # servidor (em outro terminal: npm run dev:web)
```

Pré-requisitos:
- Google Agenda conectado no painel (aba Calendar).
- WhatsApp conectado (aba Connection).
- Um segundo celular para fazer o papel de cliente.

Para testar o lembrete sem esperar 24 horas, encurte os prazos no `.env` e reinicie o servidor:

```dotenv
REMINDER_LEAD_MINUTES=10     # padrão 1440 (24 h): quanto antes do horário o lembrete pode sair
REMINDER_CUTOFF_MINUTES=2    # padrão 120 (2 h): depois disso, o lembrete não sai mais
REMINDER_TICK_MS=15000       # padrão 60000: intervalo do agendador
```

Volte aos padrões no fim do teste.

## 2. Aba Appointments (US1)

1. Pelo WhatsApp do cliente, marque um horário para hoje (se a regra de antecedência deixar) ou para amanhã.
2. No painel, abra **Appointments**: o horário aparece em **Today** ou **Tomorrow**, com nome, serviço, telefone e situação do lembrete.
3. Com a aba aberta, cancele o horário pelo WhatsApp ("cancel my appointment" → YES). A linha some sem recarregar.
4. Marque de novo e clique em abrir a conversa: o painel vai para Conversations com a conversa do cliente aberta.
5. Em Conversations, clique em **Delete all conversations**. Volte a Appointments: o horário continua lá, sem o link da conversa (R1).

## 3. Ficha do cliente (US2)

1. Em **Customers**, abra a ficha do cliente com horário futuro e troque o nome ("Maria" → "Maria Souza"). Salve.
2. Confira:
   - a ficha e a lista mostram o nome novo;
   - no Google Agenda, o evento passou a "Maria Souza — <serviço>";
   - pelo WhatsApp, "what's my name?" → o assistente usa o nome novo.
3. Tente salvar o nome vazio: o painel recusa.
4. Escreva em Notes "allergic to latex", salve e recarregue: a anotação continua lá e aparece na linha do horário em Appointments.
5. Clique em **View conversation**: abre a conversa. Num cliente cuja conversa foi apagada, o botão fica desativado com a explicação.

## 4. Marcar pelo painel (US3)

1. Em Appointments, clique em **New appointment** e digite um telefone que nunca falou com a clínica no formato `(71) 98888-7777`.
2. Preencha nome e serviço, escolha um dia e um horário (só aparecem os livres) e confirme.
3. Confira:
   - o evento no Google Agenda é "<nome> — <serviço>";
   - o horário aparece em Appointments com origem painel e lembrete "Remind manually" quando estiver na janela, porque não há conversa;
   - o cliente está em Customers;
   - pelo WhatsApp, outro cliente não recebe esse horário entre as opções.
4. Tente marcar de novo para o mesmo telefone: o painel avisa que ele já tem horário.
5. Abra **New appointment** em duas abas, escolha o mesmo horário nas duas e confirme nas duas: a segunda recebe "slot taken" e os horários livres de novo.
6. Do celular do cliente, mande "when is my appointment?" e depois "cancel my appointment" → YES: o assistente acha e cancela o horário marcado pelo painel.

## 5. Lembrete (US4), com os prazos encurtados do passo 1

1. **Janela aberta**:
   - Pelo WhatsApp do cliente, marque um horário para daqui a uns 20 minutos (ajuste a antecedência mínima na aba Calendar, se precisar) e continue conversando.
   - Quando faltarem 10 minutos, o lembrete chega no celular.
   - A conversa no painel mostra o lembrete e o registro "🔔 Reminder sent".
   - Responda **YES**: o assistente agradece, e Appointments mostra **Confirmed**.
2. **Janela fechada**: marque pelo painel para um telefone sem conversa recente. Na janela do lembrete, Appointments mostra **Remind manually** e nada chega ao celular. Clique em **Confirm** (o operador avisou por telefone): a situação vira **Confirmed**.
3. **Prazo vencido**: deixe um "Remind manually" sem confirmar até faltarem menos de 2 minutos. A situação vira **Not sent** com o motivo.
4. **Cliente pediu para sair**: mande STOP do celular, marque pelo painel para esse número e confira **Not sent: customer opted out**, sem mensagem no celular.
5. **Resposta NO ao lembrete**: o assistente pergunta se o cliente quer remarcar.
6. **Remarcação**: remarque um horário com lembrete já enviado. A situação volta para o lembrete pendente do horário novo.

## 6. Resultado esperado

- `npm test` verde, com os testes novos de `booking.ts`, do agendador de lembretes, do roteador com `awaitingReminder`, das rotas do painel e dos repositórios.
- `npx tsx --env-file=.env scripts/eval-scheduling.ts` continua com 23/23 (a mudança de `findFutureBooked` para o telefone não pode mudar o resultado).
