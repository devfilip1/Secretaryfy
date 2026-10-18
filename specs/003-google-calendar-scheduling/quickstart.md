# Quickstart: validar o agendamento de ponta a ponta

Roteiro para provar que a feature funciona. Cada passo indica a user story ou o critério da [spec](spec.md) que ele cobre. Não precisa de um segundo número: o cliente é simulado pelo webhook com o seu próprio número, e as respostas chegam no chat "Você" do WhatsApp ([research.md R12](research.md#r12-como-medir-sc-002-a-sc-005-sem-outro-número)).

## Pré-requisitos

- O ambiente das features 001 e 002 funcionando: Postgres e Evolution (`docker compose up -d`), RAG (`.\run.ps1 serve` em `rag/`), Ollama com `llama3`, WhatsApp conectado pelo painel.
- No [Google Cloud Console](https://console.cloud.google.com/), no projeto do `GOOGLE_CLIENT_ID`:
  1. **APIs e serviços > Biblioteca**: ativar a **Google Calendar API**.
  2. **Credenciais > cliente OAuth**: URI de redirecionamento `http://localhost:3000/auth/google/callback`.
  3. **Tela de consentimento OAuth**: adicionar os escopos de [contracts/google-calendar.md](contracts/google-calendar.md#oauth) e o Gmail da clínica como **usuário de teste**.
- Uma agenda de teste na conta Google (recomendado: crie uma agenda "DentalSafe teste" para não misturar com a pessoal).
- No `.env`: `PANEL_URL=http://localhost:5173` em desenvolvimento. `OLLAMA_URL`, `AGENT_MODEL` e `AGENT_TIMEOUT_MS` podem ficar com os padrões.

## 1. Preparar

```powershell
npm install                  # + luxon
npm run db:migrate           # 0002: agenda, regras, sessões, agendamentos; 0003: remove users e google_accounts
npm test                     # availability, datas, interpretador e fluxo com agenda falsa
npm run dev                  # Fastify em :3000
npm run dev:web              # painel em :5173
```

**Esperado**: testes verdes; o servidor sobe sem erro de variável de ambiente.

## 2. Conectar a agenda e definir regras (US3, SC-007)

1. No painel, abra **Agenda** e clique em **Conectar Google Agenda**. Autorize com a conta de teste.
   **Esperado**: volta ao painel com a conta conectada e a agenda principal selecionada.
2. Escolha a agenda "DentalSafe teste" (FR-002).
3. Salve as regras: segunda a sexta, 09:00–18:00, 60 min, antecedência 2 h, 30 dias, cancelamento 24 h.
4. Tente salvar `start` 18:00 e `end` 09:00 num dia. **Esperado**: erro de validação no campo.
5. Clique em conectar e, na tela do Google, cancele. **Esperado**: aviso no painel e conexão inalterada (US3, cenário 4).

Cronometre os passos 1 a 3: devem levar menos de 5 minutos (SC-007).

## 3. Simular o cliente

O script manda uma mensagem de cliente ao webhook, com o número conectado como remetente:

```powershell
npx tsx --env-file=.env scripts/simulate-customer.ts "I'd like to book an appointment"
```

Use o mesmo comando, trocando o texto, nos passos seguintes. A resposta chega no chat "Você" do WhatsApp e aparece na conversa do painel.

## 4. Consultar e marcar (US1, US2)

1. No Google Agenda, crie um evento ocupado amanhã das 10:00 às 12:00.
2. `"What times do you have tomorrow?"` → lista numerada **sem** 10:00 e 11:00 (US2, cenário 1; FR-012).
3. `"I'd like to book an appointment"` → dias numerados (US1, cenário 1).
4. `"1"` → horários do dia (cenário 6 da US1). `"2"` → resumo com dia, hora e nome (FR-014).
5. Antes de confirmar, crie no Google um evento nesse mesmo horário. `"yes"` → `slot_taken` com novas opções e **nenhum** evento novo (FR-015).
6. Escolha outro horário e `"yes"` → `booked`. **Esperado**: o evento aparece no Google com título `Avaliação — <nome>`, o WhatsApp na descrição e a duração de 60 min (FR-016). No painel, a conversa mostra `📅 Agendado pelo assistente…` (US4).
7. `"Do you have anything on Sunday?"` → `day_full` com os dias mais próximos (US2, cenário 3).
8. `"How much are braces?"` → resposta do folheto, como na feature 001 (FR-021).

## 5. Um horário por número, cancelar e remarcar (US5)

1. `"I want to book another appointment"` → `already_booked` (FR-019). `"yes"` → oferta de dias para remarcar. Escolha, confirme e confira o evento movido no Google e `📅 Remarcado…` no painel.
2. `"Cancel my appointment"` → `confirm_cancel`. `"yes"` → evento removido do Google e `📅 Cancelado pelo cliente…`.
3. Marque um horário e, no Google, mova o evento manualmente. `"When is my appointment?"` → o horário **novo** (FR-018a).
4. Apague o evento direto no Google. `"When is my appointment?"` → `no_appointment`, e o painel mostra `📅 Cancelado na agenda…`.
5. No painel, mude o prazo de cancelamento para 1440 min e marque um horário daqui a menos de 24 h (ajuste a antecedência para 0 se precisar). `"Cancel my appointment"` → `too_late_to_change`, e o evento continua no Google (FR-027).

## 6. Desistência e pausa (FR-024a, FR-023)

1. `"I'd like to book"`, depois `"banana"` → `unclear`; `"purple"` → `handoff`.
   **Esperado**: o assistente fica pausado na conversa, ela aparece destacada no painel, e a próxima mensagem não recebe resposta (SC-009).
2. Abra a conversa no painel. **Esperado**: o destaque some. Reative o assistente e confira que ele volta a responder.

## 7. Falhas da agenda (FR-022, US3 cenário 6)

1. No painel, desconecte a agenda. `"I'd like to book"` → `calendar_unavailable`.
2. Reconecte. Em <https://myaccount.google.com/permissions>, remova o acesso do app. `"What times do you have tomorrow?"` → `calendar_unavailable`, e o painel mostra **Reconectar** sem recarregar a página.

## 8. Medir com o modelo real (SC-002 a SC-005, SC-008)

```powershell
npx tsx --env-file=.env scripts/eval-scheduling.ts               # 20 conversas roteirizadas, agenda falsa
$env:AGENT_MODEL="llama3.1:8b"; npx tsx --env-file=.env scripts/eval-scheduling.ts   # comparar modelos
```

**Esperado**: 0 horários fora da regra (SC-002), 0 duplicidades (SC-003), 0 eventos sem confirmação (SC-004), acerto de dia e hora ≥ 90% (SC-005) e tempo por resposta ≤ 30 s (SC-008). O script imprime o resultado de cada conversa e um resumo.
