# Quickstart: validar a feature 005

Roteiro para conferir, de ponta a ponta, o nome do cliente, o serviço no evento e o cadastro de clientes. Textos esperados em [contracts/conversation.md](contracts/conversation.md); tabelas em [data-model.md](data-model.md).

## 1. Pré-requisitos

- Tudo da feature 003 funcionando: Postgres e Evolution (`docker compose up -d`), Ollama com `llama3`, serviço RAG (`.\run.ps1 serve` em `rag/`), agenda Google conectada no painel.
- Migration aplicada: `npm run db:migrate` (cria `customers` e as colunas novas).
- Servidor e painel: `npm run dev` e `npm run dev:web`.
- Um segundo celular para fazer o papel do cliente, ou `scripts/simulate-customer.ts` com `--phone` de um número que ainda não conversou com a clínica.

## 2. Testes automáticos

```powershell
npm run typecheck
npm test
```

Devem cobrir, sem rede: regras de nome do interpretador (aceita "My name is Maria Souza", "I'm Maria", "maria" logo depois do pedido; recusa "why?", "no", "Braces", emoji), detecção de serviço pela conversa, etapa `choose_service`, troca de serviço no resumo, título do evento na agenda falsa, upsert do cadastro (um registro por telefone, nome atualizado, nada gravado quando a marcação falha) e cadastro intacto depois de `DELETE /api/conversations`.

## 3. Nome no começo da conversa (US1)

1. Do número novo, mande `Hi`.
   - Esperado: uma saudação e, em outra mensagem, `… may I have your name?` (SC-001).
2. Responda `Maria`.
   - Esperado: `Nice to meet you, Maria! …`. No painel, a conversa passa a se chamar **Maria**.
3. Mande `How much is whitening?`.
   - Esperado: só o preço; o nome não é pedido de novo (SC-002).
4. Com outro número novo, mande `How much is a cleaning?` como primeira mensagem.
   - Esperado: o preço **e** o pedido de nome (FR-002). Responda `why?`: o nome não é gravado e não é pedido de novo fora do agendamento.

## 4. Serviço no evento (US2)

1. No número da Maria (que perguntou sobre whitening), mande `I'd like to book an appointment`, escolha um dia e um horário.
   - Esperado: o resumo com `👤 Maria` e `🦷 Teeth Whitening`, sem perguntar nome nem serviço (SC-007).
2. Responda `actually I want a cleaning`.
   - Esperado: o resumo de novo com `🦷 Dental Cleaning`.
3. Responda `yes`.
   - Esperado: no Google Agenda, o evento **"Maria — Dental Cleaning"** (SC-003).
4. Com o segundo número (sem tratamento citado), marque um horário.
   - Esperado: a lista numerada de serviços antes do resumo; responder `9` ou `not sure` dá `🦷 General assessment` e o evento "<nome> — Assessment".
5. Remarque um dos horários pelo WhatsApp: o evento muda de horário e mantém o título.

## 5. Cadastro de clientes (US3)

```powershell
docker exec secretaryfy-postgres-1 psql -U postgres -d postgres -c "select id, name, phone from customers order by created_at"
```

1. Depois do passo 4.3: uma linha para o número da Maria (SC-006).
2. Cancele e marque de novo pelo mesmo número, dizendo `my name is Maria Souza` antes: continua uma linha só, agora com `Maria Souza` (SC-005).
3. Um número que só conversou, ou desistiu no resumo (`no` e depois `never mind`), não aparece.
4. No painel, clique em **Apagar todas as conversas** e consulte de novo: o cadastro continua igual.
5. Do número da Maria, mande `Hi` de novo: o assistente não pede o nome, e o painel mostra a conversa como **Maria Souza**.
