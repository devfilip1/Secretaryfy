---

description: "Task list for feature 005 — nome do cliente, cadastro de clientes e serviço no agendamento"
---

# Tasks: Nome do cliente, cadastro de clientes e serviço no agendamento

**Input**: Design documents from `/specs/005-customer-name-registry/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Incluídos. O plano define a estratégia (`node:test` sem rede, Ollama falso, agenda falsa em `src/test/fake-calendar.ts`, PGlite) e o projeto mantém testes ao lado de cada módulo (`*.test.ts`). Cada tarefa de teste fica junto do módulo que testa e é escrita antes da implementação da mesma história.

**Organization**: Uma fase por história do spec, na ordem de prioridade. US1 e US2 são P1; US3 é P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo, porque mexe em arquivos diferentes e não depende de tarefa incompleta
- **[Story]**: história do spec (US1, US2, US3)
- Os caminhos são relativos à raiz do Secretaryfy

## Convenções que valem para todas as tarefas

- **Idioma:** comentários e código de `src/` em português; textos ao cliente em inglês, exatamente como em [contracts/conversation.md](contracts/conversation.md).
- **Imports:** em `src/` terminam em `.js`.
- **Nome conhecido:** em nenhum lugar do agendamento, do evento ou do cadastro se usa `conversations.name` (nome do perfil do WhatsApp). Ao final, `grep -nE "conversation\.name\b" src/modules/scheduling/*.ts | grep -v test` não mostra nenhuma linha.
- **Envio:** respostas continuam saindo só por `gate.sendAssistant`; no máximo 3 mensagens por resposta, contando o pedido de nome.
- **Textos fixos:** o modelo nunca escreve o pedido de nome, a lista de serviços, o resumo nem o título do evento (research.md R2, R4).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Banco que as três histórias usam.

- [X] T001 Alterar `src/db/schema.ts` conforme [data-model.md](data-model.md):
  - nova tabela `customers` (`id` uuid PK `defaultRandom()`, `phone` text not null **unique**, `name` text not null, `createdAt`/`updatedAt` timestamptz `defaultNow()`), **sem FK** para `conversations`; exportar `CustomerRow`;
  - `conversations`: colunas `customerName` (`customer_name`, text, null) e `nameAskedAt` (`name_asked_at`, timestamptz, null);
  - `schedulingStep`: adicionar `"choose_service"` ao **fim** do enum;
  - `schedulingSessions`: coluna `service` (text, null);
  - `SessionOption`: terceira variante `{ n: number; kind: "service"; service: string }`;
  - `appointments`: colunas `service` (text, null) e `customerId` (`customer_id`, uuid, null, `.references(() => customers.id, { onDelete: "set null" })`).
- [X] T002 Gerar a migration com `npm run db:generate` e renomear para `drizzle/0005_customers.sql` (ajustando `drizzle/meta/_journal.json`). Conferir que ela só tem: `ALTER TYPE "scheduling_step" ADD VALUE 'choose_service'`, `CREATE TABLE "customers"` com o índice único de `phone`, os `ALTER TABLE … ADD COLUMN` e a FK de `appointments.customer_id`. Nenhum `UPDATE`/`INSERT`. Adicionar `customers` ao `truncate` de `src/test/db.ts`. Rodar `npm test` para confirmar que as migrations aplicam no PGlite.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cadastro de clientes legível, nome conhecido de um número e as funções de banco do nome. Ao fim desta fase, nada muda para o cliente.

**⚠️ CRITICAL**: Nenhuma história começa antes desta fase.

- [X] T003 [P] Criar `src/modules/customers/repository.ts` com `createCustomerRepository(db)`, no padrão de `src/modules/inbox/repository.ts`:
  - `findByPhone(phone): Promise<CustomerRow | null>`;
  - `upsert({ phone, name, at }): Promise<CustomerRow>`: `insert … onConflictDoUpdate({ target: customers.phone, set: { name, updatedAt: at } })` com `.returning()` (research.md R5).

  Exportar o tipo `CustomerRepository`.
- [X] T004 [P] Criar `src/modules/customers/repository.test.ts` com `createTestDb()` de `src/test/db.ts`: `upsert` de um número novo cria a linha com id; `upsert` do mesmo número não cria outra e troca o nome e o `updatedAt`; `findByPhone` de número desconhecido devolve `null`; dois `upsert` simultâneos do mesmo número (`Promise.all`) deixam uma linha só.
- [X] T005 [P] Em `src/modules/inbox/repository.ts`:
  - `setCustomerName(conversationId, name): Promise<ConversationRow | null>`;
  - `markNameAsked(conversationId, at): Promise<void>`: só grava se `name_asked_at` for nulo;
  - `customerMessagesSince(conversationId, since): Promise<number>`: quantidade de mensagens `origin = 'customer'` com `sent_at > since`;
  - `listConversations`: a busca `q` procura também em `customer_name` (`or(ilike(customerName), ilike(name), ilike(phone))`).

  Testes em `src/modules/inbox/repository.test.ts` para as três funções e para a busca por `customer_name`.
- [X] T006 [P] Em `src/modules/inbox/presenters.ts`, `presentConversation` passa a usar `name: row.customerName ?? row.name` (contracts/panel-api.md). Teste em `src/modules/inbox/presenters.test.ts`: com `customerName` vale ele; sem, vale `name`.
- [X] T007 Em `src/modules/inbox/service.ts` (depende de T003 e T005):
  - receber nas dependências `customers: Pick<CustomerRepository, "findByPhone">`;
  - `knownName(conversation): Promise<string | null>` = `conversation.customerName` → `customers.findByPhone(conversation.phone)?.name` → `null` (research.md R1). Nunca `conversation.name`;
  - `setCustomerName(conversationId, name)`: grava e publica `conversation.updated` com a conversa apresentada (o painel troca o nome na hora).

  Montar a dependência em `src/routes/inbox.ts` com `createCustomerRepository(db)`, exportando a instância `customerRepo`. Ajustar os testes existentes de `src/modules/inbox/service.test.ts` que constroem o serviço e adicionar testes de `knownName` (conversa com nome dito; só cadastro; só perfil → `null`).

**Checkpoint**: `npm run typecheck && npm test` passam; o assistente se comporta como antes.

---

## Phase 3: User Story 1 - O assistente pergunta o nome no começo da conversa (Priority: P1) 🎯 MVP

**Goal**: O assistente pede o nome na primeira resposta a um número sem nome conhecido, sem deixar a pergunta do cliente sem resposta, reconhece o nome, não pede de novo e o agendamento usa esse nome.

**Independent Test**: [quickstart.md §3](quickstart.md#3-nome-no-começo-da-conversa-us1): de um número novo, "Hi" → saudação + pedido de nome; "Maria" → "Nice to meet you, Maria!…" e o painel mostra Maria; "How much is whitening?" → só o preço.

### Tests for User Story 1

- [X] T008 [P] [US1] Em `src/modules/scheduling/interpret.test.ts`, conforme [contracts/interpreter.md](contracts/interpreter.md):
  - sem modelo: "My name is maria souza" (sem `awaitingName`) → `give_name` com `"Maria Souza"`; com `awaitingName`: "I'm Maria", "it's Maria", "maria" → `give_name` `"Maria"`;
  - com `awaitingName`, **não** viram nome e vão para o modelo: "why?", "no", "hello", "Braces", "how much is it", "👍";
  - sem `awaitingName`, "Maria" não vira `give_name` pelas regras;
  - nome com mais de 4 palavras ou mais de 60 caracteres é recusado;
  - modelo (Ollama falso) com `awaitingName` devolvendo `{intent: "question", name: "maria"}` → `question` com `name: "Maria"`; sem `awaitingName`, o mesmo retorno perde o `name`;
  - com `awaitingName`, o prompt de sistema enviado ao modelo contém "has just asked the customer's name".
- [X] T009 [P] [US1] Em `src/modules/whatsapp/handle-message.test.ts`: com `followUp`, uma resposta que se dividiria em 3 partes sai em 2 + o `followUp` (3 mensagens no total); o `followUp` sai por último; se uma parte for bloqueada, o `followUp` não sai; `splitReply(text, 2)` nunca devolve mais de 2 partes.
- [X] T010 [P] [US1] Em `src/modules/scheduling/router.test.ts` (ampliar o `setup` com `knownName`, `awaitingName`, `setCustomerName`, `markNameAsked`):
  - sem nome conhecido e sem pedido anterior, resposta do folheto vem com `followUp` de `replies.askNameFollowUp` e `markNameAsked` é chamado;
  - com `name_asked_at` já preenchido, ou com nome conhecido, não há `followUp`;
  - despedida e respostas do agendamento nunca têm `followUp`;
  - `give_name` sem sessão grava o nome e responde `replies.nameReceived(name)`, sem chamar o folheto;
  - `question` com `name` grava o nome e responde pelo folheto, sem `followUp`;
  - cliente cadastrado sem `customer_name` na conversa: o roteador copia o nome do cadastro para a conversa;
  - o interpretador recebe `awaitingName: true` só na primeira mensagem depois do pedido.
- [X] T011 [P] [US1] Em `src/modules/scheduling/flow.test.ts`: ao escolher o horário, com nome conhecido passado pelo roteador, vai direto para o resumo com esse nome; sem nome conhecido, pede o nome (`ask_name`) **mesmo que a conversa tenha `name` do perfil**; o nome do resumo é o do evento.

### Implementation for User Story 1

- [X] T012 [US1] Em `src/modules/scheduling/interpret.ts`:
  - `InterpretInput.awaitingName: boolean`;
  - `NOT_NAMES`: conjunto de palavras que não são nome ([contracts/interpreter.md](contracts/interpreter.md#regras-sem-modelo-ordem-de-avaliação)), incluindo as palavras do catálogo de serviços (`services.ts`, T021; até lá, a lista dos tratamentos escrita direto);
  - `cleanName(raw): string | null`: tira pontuação das pontas, normaliza espaços, capitaliza cada palavra, recusa >4 palavras, >60 caracteres, palavra em `NOT_NAMES` ou sem letra;
  - regras na ordem do contrato: "my name is / my name's / call me X" em qualquer etapa; com `awaitingName`, "I'm / I am / it's / this is X" ou a mensagem inteira como nome; `ask_name` passa a usar `cleanName`. A despedida continua antes delas;
  - prompt: com `awaitingName`, acrescentar `The assistant has just asked the customer's name. If the message contains it, set "name".`;
  - `validate()`: mantém `name` (via `cleanName`) em qualquer intenção quando `awaitingName`; `give_name` sem nome válido vira `unclear`.
- [X] T013 [P] [US1] Em `src/modules/scheduling/replies.ts`: `askNameFollowUp(random?)` com as 3 variações e `nameReceived(name, random?)` com as 2 variações de [contracts/conversation.md](contracts/conversation.md). Testes em `src/modules/scheduling/replies.test.ts`.
- [X] T014 [P] [US1] Em `src/modules/whatsapp/handle-message.ts`:
  - `Reply.followUp?: string`;
  - `splitReply(text, maxParts = MAX_PARTS)`: respeita `maxParts` nos parágrafos e na divisão por frases;
  - no envio, `parts = splitReply(text, followUp ? MAX_PARTS - 1 : MAX_PARTS)`, depois `keepFresh`, depois o `followUp` como última mensagem; se uma parte não sair, o `followUp` também não sai.
- [X] T015 [US1] Em `src/modules/scheduling/router.ts` (depende de T007, T012, T013, T014):
  - dependências novas: `inbox` passa a incluir `knownName`, `setCustomerName`, `markNameAsked`, `customerMessagesSince`;
  - no início: `known = await inbox.knownName(conversation)`; se a conversa não tem `customerName` mas `known` existe (veio do cadastro), `setCustomerName` (research.md R7);
  - `awaitingName = !known && conversation.nameAskedAt !== null && (await inbox.customerMessagesSince(id, conversation.nameAskedAt)) <= 1` (a atual já está gravada);
  - passar `awaitingName` ao interpretador;
  - depois de interpretar: com `interpretation.name` e sem etapa `ask_name` em andamento, `setCustomerName` e `known = name`;
  - `give_name` sem sessão: `{ text: replies.nameReceived(name) }`;
  - respostas do folheto: se `!known && conversation.nameAskedAt === null`, `markNameAsked(now)` e `followUp: replies.askNameFollowUp()`;
  - passar `knownName: known` para `flow.handle`.
- [X] T016 [US1] Em `src/modules/scheduling/flow.ts`: `handle` recebe `knownName: string | null`; `selectSlot` usa `this.session?.customerName ?? knownName` (nunca `this.conversation.name`); `book()` usa `s.customerName` (sempre preenchido depois do resumo). Na etapa `ask_name`, o nome recebido também é gravado na conversa: o fluxo recebe `inbox.setCustomerName` nas dependências e chama ao ir para o resumo.
- [X] T017 [US1] Montar as dependências novas em `src/routes/evolution-webhook.ts` (roteador e fluxo com `inbox` já ligado ao `customerRepo` de T007). Rodar `npm run typecheck && npm test`.

**Checkpoint**: US1 completa e testável sozinha pelo quickstart §3.

---

## Phase 4: User Story 2 - O evento na agenda mostra o nome do cliente e o serviço (Priority: P1)

**Goal**: Todo agendamento tem um serviço — o tratamento citado na conversa ou o escolhido numa lista — mostrado no resumo, trocável antes do "sim", e o evento se chama `"<nome> — <serviço>"`.

**Independent Test**: [quickstart.md §4](quickstart.md#4-serviço-no-evento-us2): perguntar sobre whitening, marcar, trocar para cleaning no resumo, confirmar e ver "Maria — Dental Cleaning" no Google Agenda.

### Tests for User Story 2

- [X] T018 [P] [US2] Criar `src/modules/scheduling/services.test.ts`:
  - `detectService(["Do you offer a clean procedure?", "how much does cost it?"])` → `"Dental Cleaning"`; vale o citado por último; sem citação → `null`; "not sure" → `"Assessment"`; palavra inteira ("pulled" sim, "pullover" não); sem acento e sem caixa;
  - `serviceByNumber(1..9)`; fora da faixa → `null`;
  - **o catálogo cobre o folheto**: lê `rag/data/index/section/chunks.json` (pula o teste se o arquivo não existir), pega a primeira linha de cada chunk, corta no " — " e confere que todo título que não seja "DentalSafe", "Why Choose DentalSafe?" ou "Schedule Your Assessment Today" está no catálogo.
- [X] T019 [P] [US2] Em `src/modules/scheduling/flow.test.ts` (agenda falsa):
  - com `mentionedService` e nome conhecido, escolher o horário vai direto ao resumo com `🦷 <serviço>`;
  - sem `mentionedService`, vai para `choose_service` com a lista de 9 opções; `choose_service` com a opção 2 → resumo com Teeth Whitening; com "Assessment" o resumo mostra `General assessment`;
  - sem nome nem serviço: `ask_name` → `choose_service` → resumo;
  - no resumo, `choose_service` com outro serviço → resumo de novo com o serviço trocado e nada criado na agenda;
  - "não entendi" em `choose_service` repete a lista; o segundo seguido passa para o operador (regra da 003);
  - ao confirmar: o evento da agenda falsa tem `summary` `"Maria — Dental Cleaning"` e `description` com `Serviço: Dental Cleaning` ([contracts/google-calendar.md](contracts/google-calendar.md)); `appointments.service` gravado; o registro `system` termina com `— Dental Cleaning`;
  - remarcar mantém o `summary` do evento.
- [X] T020 [P] [US2] Em `src/modules/scheduling/interpret.test.ts`: na etapa `choose_service`, "3", "whitening", "not sure" → `choose_service` com o serviço, sem modelo; "10" → `unclear`; em `confirm_booking`, "actually I want a cleaning" → `choose_service`, e "yes" continua `yes`; modelo devolvendo `choose_service` com serviço fora do catálogo → `unclear`.

### Implementation for User Story 2

- [X] T021 [P] [US2] Criar `src/modules/scheduling/services.ts` com o catálogo de [data-model.md](data-model.md#catálogo-de-serviços-código-não-tabela): `SERVICES` (nome + palavras, na ordem do folheto), `ASSESSMENT = "Assessment"`, `detectService(texts: string[]): string | null` (último citado), `serviceByNumber(n)`, `serviceLabel(service)` ("General assessment" para Assessment). Trocar a lista provisória de T012 em `NOT_NAMES` pelas palavras do catálogo.
- [X] T022 [P] [US2] Em `src/modules/scheduling/replies.ts`: `chooseService()` (lista do contrato), `confirmBooking(start, minutes, name, service, tz)` com a linha `🦷` e o novo rodapé, e `systemNotes.booked(start, minutes, tz, service)` com `— <serviço>` no fim. Ajustar `src/modules/scheduling/replies.test.ts`.
- [X] T023 [P] [US2] Em `src/modules/scheduling/sessions.ts`: `SessionDraft` e `saveSession` com `service`; `insertBooked` recebe `service` e `customerId?: string | null`.
- [X] T024 [US2] Em `src/modules/scheduling/interpret.ts` (depende de T021): intenção `choose_service` e campo `Interpretation.service`; regras das etapas `choose_service` e `confirm_booking` (contrato, itens 2 e 3); `choose_service` no enum e na lista de intenções do prompt; `validate()` aceita `choose_service` só com serviço do catálogo e zera `service` nas outras intenções.
- [X] T025 [US2] Em `src/modules/scheduling/flow.ts` (depende de T021–T024):
  - `handle` recebe `mentionedService: string | null`; `carry` passa a levar `service` (inicial: `session?.service ?? mentionedService`);
  - `selectSlot` → `ask_name` se falta nome; senão `choose_service` se falta serviço; senão resumo. `give_name` em `ask_name` segue a mesma regra;
  - etapa `choose_service`: opções `{kind: "service"}` 1..9; `choose_service` → resumo; `repeatPrompt` devolve `replies.chooseService()`;
  - `confirm_booking` + `choose_service` → resumo com o serviço novo;
  - `book()`: `summary: \`${name} — ${service}\``, `description` do contrato, `insertBooked` com `service`, `systemNotes.booked` com o serviço.
- [X] T026 [US2] Em `src/modules/scheduling/router.ts`: `mentionedService = detectService([...history.filter(user).map(content), text])` passado ao `flow.handle`.
- [X] T027 [P] [US2] Em `scripts/fixtures/scheduling-scenarios.json` e `scripts/eval-scheduling.ts`: dois cenários novos — tratamento citado antes de marcar (o resumo já vem com ele) e nenhum tratamento citado (a lista aparece; "2" escolhe Teeth Whitening) — conferindo o `summary` do evento na agenda falsa (SC-004).

**Checkpoint**: US1 e US2 funcionam juntas; quickstart §3 e §4 passam.

---

## Phase 5: User Story 3 - Quem marca pela primeira vez entra no cadastro de clientes (Priority: P2)

**Goal**: Todo agendamento confirmado inclui ou atualiza o cliente no cadastro (um por telefone), que sobrevive à limpeza das conversas e faz o assistente reconhecer quem volta.

**Independent Test**: [quickstart.md §5](quickstart.md#5-cadastro-de-clientes-us3): marcar com um número novo e ver a linha em `customers`; marcar de novo e continuar com uma linha; apagar as conversas e o cadastro continuar.

### Tests for User Story 3

- [X] T028 [P] [US3] Em `src/modules/scheduling/flow.test.ts` (com `createCustomerRepository` no PGlite ou um repositório falso): confirmar um horário cria o cliente com nome e telefone e grava `appointments.customer_id`; marcar de novo com outro nome não cria outro cliente e troca o nome; desistir (`no` / `stop`), horário tomado e falha do `createEvent` não criam cliente; falha no `upsert` depois de marcado não desfaz o agendamento e a resposta continua `booked`.
- [X] T029 [P] [US3] Em `src/routes/panel-api.test.ts`: depois de `DELETE /api/conversations` e de `DELETE /api/connection`, as linhas de `customers` continuam.
- [X] T030 [P] [US3] Em `src/modules/scheduling/router.test.ts`: número com cadastro e conversa nova (sem `customer_name`) → nenhum pedido de nome e o nome do cadastro vai para a conversa e para o resumo do agendamento.

### Implementation for User Story 3

- [X] T031 [US3] Em `src/modules/scheduling/flow.ts`: dependência `customers: Pick<CustomerRepository, "upsert">`; em `book()`, depois de `insertBooked` dar certo, `upsert({ phone, name, at: now })` dentro de `try/catch` (erro vai para o log, não desfaz nada); guardar o `customer_id` no agendamento (nova função em `sessions.ts`: `setCustomer(appointmentId, customerId)`). O evento do Google não muda: o cliente é gravado só depois de o evento existir (FR-018). Montar a dependência em `src/routes/evolution-webhook.ts` com `customerRepo`.
- [X] T032 [US3] Conferir que `inbox.clearAll()` (`src/modules/inbox/service.ts`) e `deleteAllConversations` não tocam em `customers` (só as FKs de `conversations` têm cascade) e que `appointments.customer_id` usa `on delete set null`. Rodar `npm test`.

**Checkpoint**: as três histórias funcionam; quickstart completo passa.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T033 [P] Atualizar `specs/003-google-calendar-scheduling/contracts/conversation.md` e `…/google-calendar.md` com um aviso no topo apontando para os deltas da 005 (resumo e título do evento mudaram).
- [X] T034 [P] Atualizar `README.md`: tabela `customers`, pedido de nome e serviço no título do evento, na seção que descreve o agendamento.
- [ ] T035 Rodar as verificações finais: `npm run typecheck`, `npm test`, o `grep` da convenção "Nome conhecido", `npx tsx --env-file=.env scripts/eval-scheduling.ts` (com Ollama) e o [quickstart.md](quickstart.md) inteiro pelo WhatsApp.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002.
- **Foundational (Phase 2)**: depende do Setup. T003, T005 e T006 em paralelo; T004 depois de T003; T007 depois de T003 e T005.
- **US1 (Phase 3)**: depende da Foundational.
- **US2 (Phase 4)**: depende da Foundational. Na prática vem depois da US1, porque mexe nos mesmos arquivos (`interpret.ts`, `flow.ts`, `router.ts`, `replies.ts`); só `services.ts` (T018, T021) pode começar junto com a US1.
- **US3 (Phase 5)**: depende da Foundational e de `book()` já com o serviço (T025), porque altera o mesmo método.
- **Polish (Phase 6)**: depois das histórias.

### User Story Dependencies

- **US1**: independente; é o MVP.
- **US2**: independente em comportamento (com nome conhecido ou pedido no `ask_name` como hoje), mas sequencial à US1 nos arquivos.
- **US3**: precisa do `book()` da US2 para ter o serviço junto; o cadastro em si é independente do pedido de nome.

### Within Each User Story

- Testes da história primeiro, falhando; depois a implementação.
- `services.ts`/`replies.ts`/`sessions.ts` antes de `interpret.ts`, que vem antes de `flow.ts`, que vem antes de `router.ts`.

### Parallel Opportunities

- Foundational: T003, T005, T006.
- US1: os testes T008–T011 juntos; T013 e T014 junto com T012.
- US2: T018–T020 juntos; T021, T022, T023 e T027 juntos.
- US3: T028–T030 juntos.
- Polish: T033 e T034.

---

## Parallel Example: User Story 2

```text
# Testes, juntos (arquivos diferentes):
T018 services.test.ts
T019 flow.test.ts (serviço)
T020 interpret.test.ts (choose_service)

# Base, junta:
T021 services.ts
T022 replies.ts
T023 sessions.ts
T027 eval-scheduling (cenários)

# Depois, em sequência:
T024 interpret.ts → T025 flow.ts → T026 router.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 e Phase 2.
2. Phase 3 (US1).
3. **Parar e validar**: quickstart §3 pelo WhatsApp. Já entrega o pedido de nome e corrige o nome do perfil ("." ) indo para o agendamento.

### Incremental Delivery

1. Setup + Foundational → nada muda para o cliente.
2. US1 → nome no começo da conversa (MVP).
3. US2 → serviço no resumo e no título do evento.
4. US3 → cadastro de clientes.
5. Cada passo roda o `npm test` inteiro e o trecho correspondente do quickstart antes do próximo.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta.
- Commit ao fim de cada fase, só com o autor configurado no git (sem linha de coautoria).
- Os agendamentos anteriores à feature ficam com `service` e `customer_id` nulos; nenhum código pode supor que esses campos estão preenchidos ao ler `appointments` antigos.
