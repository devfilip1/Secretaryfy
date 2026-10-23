---

description: "Task list for feature 004 — proteção do número contra banimento (anti-ban)"
---

# Tasks: Proteção do número contra banimento (anti-ban)

**Input**: Design documents from `/specs/004-whatsapp-anti-ban/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Incluídos. O plano define a estratégia (`node:test`, sem rede, relógio falso, Postgres de teste) e o projeto mantém testes ao lado de cada módulo (`*.test.ts`). Cada tarefa de teste fica junto do módulo que testa.

**Organization**: Uma fase por história do spec, na ordem de prioridade. US1, US2 e US3 são P1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo, porque mexe em arquivos diferentes e não depende de tarefa incompleta
- **[Story]**: história do spec (US1…US6)
- Os caminhos são relativos à raiz do Secretaryfy

## Convenções que valem para todas as tarefas

- **Idioma:** comentários e código de `src/` em português; textos ao cliente em inglês ([contracts/conversation.md](contracts/conversation.md)).
- **Imports:** em `src/` terminam em `.js`, como no resto do servidor.
- **Envio:** nenhum arquivo fora de `src/modules/antiban/gate.ts` pode chamar `sendWhatsAppText`. Ao final, `grep -rn "sendWhatsAppText" src --include=*.ts | grep -v test` mostra só `evolution.ts` (a definição), `gate.ts` e `index.ts` ou `evolution-webhook.ts` (onde o portão é montado).
- **Logs:** os da proteção levam `conversationId` e o código do motivo, nunca o texto da mensagem.
- **Tempo:** toda função com tempo recebe `now` e, quando espera, `setTimeout`/`clearTimeout` injetáveis, para os testes usarem relógio falso.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuração e banco que todas as histórias usam.

- [X] T001 Adicionar as variáveis `ANTIBAN_*` em `src/config/env.ts`, com os padrões da tabela em [data-model.md#configuração](data-model.md#configuração). Números com `z.coerce.number().int().nonnegative()`. `ANTIBAN_ALLOWED_LINK_DOMAINS` vira `z.string().default("")`, transformada em lista em minúsculas e sem vazios. Um `superRefine` recusa: `TYPING_MIN > TYPING_MAX`, `GAP_MIN > GAP_MAX`, `WARMUP_PER_MINUTE > PER_MINUTE` e `WARMUP_CONVERSATIONS_PER_DAY > CONVERSATIONS_PER_DAY`.
- [X] T002 Alterar `src/db/schema.ts`:
  - adicionar `"blocked"` ao fim de `messageStatus`;
  - adicionar a `messages` o índice parcial `messages_outgoing_sent_at_idx` em `sentAt.desc()`, com `.where(sql\`origin in ('assistant','operator') and status in ('sending','sent')\`)`;
  - criar as tabelas `contactPreferences` (`contact_preferences`), `connectedNumbers` (`connected_numbers`) e `protectionState` (`protection_state`, com `check("protection_state_singleton", sql\`id = 1\`)`), conforme [data-model.md](data-model.md);
  - exportar os tipos `ContactPreferenceRow`, `ConnectedNumberRow` e `ProtectionStateRow`.

  As novas tabelas **não** têm FK para `conversations`.
- [X] T003 Gerar a migration com `npm run db:generate` e conferir que `drizzle/0004_antiban.sql` só tem: `ALTER TYPE "message_status" ADD VALUE 'blocked'`, as três tabelas, o CHECK e o índice. Ela não pode ter nenhum `UPDATE`/`INSERT` que use `blocked`. Renomeie o arquivo para `0004_antiban.sql` se o Drizzle der outro nome, ajustando `drizzle/meta/_journal.json`.
- [X] T004 [P] Adicionar ao tipo `InboxEvent` de `src/modules/inbox/events.ts` a variante `{ type: "protection.updated" } & ProtectionJson`. O tipo `ProtectionJson` é exportado de `src/modules/antiban/limits.ts` (T006), com o formato de [contracts/panel-api.md](contracts/panel-api.md#proteção-protectionjson). Espelhar em `web/src/useEvents.ts`: o tipo, o item em `SERVER_EVENTS` e o tipo `Protection` em `web/src/api.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: O portão único com uma fila simples, a gravação de `blocked` e os dois chamadores trocados. Ao fim desta fase, todo envio passa pelo portão; o comportamento ao cliente ainda é o de hoje, só serializado.

**⚠️ CRITICAL**: Nenhuma história começa antes desta fase.

- [X] T005 [P] Criar `src/modules/antiban/repository.ts` com `createAntibanRepository(db)`, no mesmo padrão de `src/modules/inbox/repository.ts`, com as funções:
  - `countOutgoingSince(since: Date)`: contagem com o mesmo filtro do índice parcial;
  - `countConversationsServedSince(since)`: `count(distinct conversation_id)` de mensagens `assistant` `sent`;
  - `servedConversationSince(conversationId, since): boolean`;
  - `countFailedSince(since)`: `assistant` ou `operator` com `status = 'failed'` e `created_at >= since`;
  - `getPreference(phone)`, `setOptedOut(phone, at: Date | null)` (upsert);
  - `rememberConnectedNumber(number, at)` (upsert: mantém `first_connected_at`, atualiza `last_connected_at`; devolve a linha), `getConnectedNumber(number)`;
  - `getProtectionState()` (linha 1 ou `null`), `setPaused(until: Date | null, reason: string | null)` (upsert da linha 1);
  - `blockOrphanSending()`: `update messages set status='blocked', error='restart' where origin='assistant' and status='sending'`, devolvendo as linhas.
- [X] T006 [P] Criar `src/modules/antiban/limits.ts`:
  - **`AntibanConfig`**: tipo com os campos de `env` sem o prefixo, em camelCase, e `configFromEnv(env)`.
  - **`warmupLimits(config, firstConnectedAt: Date | null, now: Date)`**: devolve `{ perMinute, perHour, conversationsPerDay, warmupUntil: Date | null }`. A interpolação é linear do valor de aquecimento ao normal ao longo de `warmupDays` (research.md R10). `perHour` no aquecimento é `round(perHour × warmupPerMinute / perMinute)` no início. Com `warmupDays = 0` ou `firstConnectedAt = null`, vale o limite normal e `warmupUntil = null`.
  - **`ProtectionJson`**: exportado.
  - **Testes:** `src/modules/antiban/limits.test.ts`, com os casos dia 0, meio do período, fim, `warmupDays = 0` e número desconhecido.
- [X] T007 Adicionar `recordBlocked({ conversationId, origin, text, reason })` em `src/modules/inbox/service.ts`. Ela insere uma mensagem com `status: "blocked"`, `error: reason` e `sentAt: now()`, sem `touchConversation`, e publica `message.created`. Junto:
  - **`src/modules/inbox/repository.ts`:**
    - `recentTexts` passa a excluir `status = 'blocked'`;
    - `lastCustomerMessageAt(conversationId)`;
    - `customerMessagesSinceLastReply(conversationId)`: mensagens `customer` mais novas que a última `assistant`/`operator` `sent`, com `id`, `waMessageId`, `text` e `sentAt`, em ordem cronológica;
    - `recentForAssessment(conversationId, limit = 30)`: `origin`, `status`, `text` e `sentAt`, sem `system` e sem `blocked`;
    - `lastAssistantTextsSince(conversationId, since)`;
    - `blockMessage(id, reason)`: muda uma linha `sending` para `blocked`.
  - **Testes:** em `src/modules/inbox/repository.test.ts`, um para `customerMessagesSinceLastReply` e um para `recentTexts` ignorando `blocked`.
- [X] T008 [P] Aceitar `status: "blocked"` no painel:
  - **`web/src/api.ts`:** a união de `Message["status"]`;
  - **`web/src/components/MessageBubble.tsx`:** mostrar `Não enviada pela proteção: ${BLOCK_REASONS[message.error] ?? message.error}`, sem botão de reenviar. O mapa `BLOCK_REASONS` fica no próprio arquivo, com os 10 códigos de [data-model.md](data-model.md#messages) e seus textos em português;
  - **`web/src/styles.css`:** o estilo, igual ao de `failed` em tom neutro.
- [X] T009 Criar `src/modules/antiban/queue.ts` com `createSendQueue({ now, setTimeout, clearTimeout, waitForSlot, deliver })`, uma fila FIFO com um único trabalhador:
  - **`enqueue(item)`:** recebe `QueueItem` = `{ messageId, conversationId, phone, text, origin, enqueuedAt, expiresAt }` e devolve uma `Promise` que resolve com o resultado final (`sent` | `failed` | `blocked` + motivo).
  - **Trabalhador:** processa um item por vez. Para cada um: (a) `await waitForSlot(item)`, que nesta fase resolve na hora e é implementado em T016; (b) chama `deliver(item)`.
  - **`drain(reason)`:** resolve todos os itens pendentes como `blocked` com o motivo e esvazia a fila.
  - **`size()`.**
  - **Testes:** `src/modules/antiban/queue.test.ts`, com ordem FIFO, um envio por vez e `drain`.
- [X] T010 Criar `src/modules/antiban/gate.ts` com `createGate({ repo, inboxRepo, inbox, send, queue, config, now, log })`. Nesta fase, o portão expõe:
  - **`sendAssistant({ conversationId, phone, text })`:** roda a lista de regras (array de funções `Rule`, vazio nesta fase, preenchido nas histórias). Uma regra devolve `null` (segue) ou `{ reason, flag?: boolean, pause?: boolean, systemText?: string }`:
    - **Recusa:** `inbox.recordBlocked`. Com `flag`, também `inbox.flagNeedsAttention`, e com `systemText`, `inbox.recordSystem`.
    - **Senão:** `inbox.startOutgoing` e `queue.enqueue`.
    - Devolve o resultado.
  - **`checkOperatorRisks(conversationId): Risk[]`:** vazio nesta fase.
  - **`deliverItem(item)`:** é o `deliver` da fila. Chama `send(item.phone, item.text)` e `inbox.finishOutgoing`, e devolve `sent` ou `failed`.

  `send` é a única referência a `sendWhatsAppText` fora de `evolution.ts`.
- [X] T011 Trocar os dois chamadores pelo portão:
  - **`src/modules/whatsapp/handle-message.ts`:** `Deps` troca `send` e `startOutgoing`/`finishOutgoing` por `gate: Pick<Gate, "sendAssistant">`, e o envio vira `await gate.sendAssistant({ conversationId, phone, text: answer.text })`.
  - **`src/modules/inbox/service.ts`:** `OperatorSendDeps.send` passa a ser `gate.sendOperator(...)`. Criar em `gate.ts` o `sendOperator({ messageId, conversationId, phone, text })`, que só enfileira, já com a linha `sending` criada pelo `startOutgoing` atual. `deliver()` usa o resultado da fila.
  - **Montagem:** em `src/routes/inbox.ts`, criar a fila e o portão e exportar `gate`. `src/routes/evolution-webhook.ts` e `src/index.ts` passam `gate` em vez de `sendWhatsAppText`.
  - **Testes:** atualizar `src/modules/whatsapp/handle-message.test.ts` e `src/routes/panel-api.test.ts` para o portão falso (`{ sendAssistant, sendOperator }`) que registra os envios.
- [X] T012 Ao subir, em `src/index.ts`, antes de `app.listen`: chamar `antibanRepo.blockOrphanSending()` e publicar `message.updated` para cada linha. O log registra só a quantidade.

**Checkpoint**: `npm run typecheck` e `npm test` passam, e o envio pelo painel e pelo assistente funciona como antes, agora passando pelo portão.

---

## Phase 3: User Story 1 - O assistente responde no ritmo de uma pessoa (Priority: P1) 🎯 MVP

**Goal**: A resposta sai com marcação de lida e "digitando…" proporcional e aleatório. As mensagens seguidas do cliente viram uma resposta só, e os envios respeitam os limites por minuto, por hora e de conversas por dia, sem rajada.

**Independent Test**: [quickstart.md §1–§3](quickstart.md). Três mensagens rápidas geram uma resposta, com "digitando…" e lida no celular. Com `ANTIBAN_PER_MINUTE=2`, a terceira resposta espera, e com fila curta ela vira `blocked rate_limited`.

### Tests for User Story 1

- [X] T013 [P] [US1] `src/modules/antiban/typing.test.ts`:
  - `typingDelay` fica sempre entre `typingMinMs` e `typingMaxMs`;
  - cresce com o tamanho do texto (média de 100 amostras);
  - dois textos iguais com `random` diferente dão tempos diferentes;
  - `gapDelay` fica entre `gapMinMs` e `gapMaxMs`.
- [X] T014 [P] [US1] `src/modules/antiban/debounce.test.ts`, com relógio falso:
  - três `push` com 1 s de intervalo disparam uma vez, 4 s depois do último;
  - conversas diferentes têm temporizadores independentes;
  - `cancel(conversationId)` impede o disparo.

### Implementation for User Story 1

- [X] T015 [P] [US1] Criar `src/modules/antiban/typing.ts` com as duas funções (research.md R3). `random` é injetável, com padrão `Math.random`:
  - `typingDelay(text, config, random)` = `clamp(800 + 45 × text.length, min, max) × (0.8 + random() × 0.45)`, arredondado e de novo limitado ao intervalo;
  - `gapDelay(config, random)`.
- [X] T016 [US1] Implementar o `waitForSlot` em `src/modules/antiban/gate.ts` e passá-lo à fila. Ele lê os limites em vigor (`warmupLimits` com o número conectado; por ora `firstConnectedAt = null`, ligado em US6) e repete até haver vaga:
  - se `countOutgoingSince(now − 60 s) >= perMinute` ou `countOutgoingSince(now − 1 h) >= perHour`, espera até a vaga mais próxima (no mínimo 1 s) e verifica de novo;
  - depois de haver vaga, espera `gapDelay` desde o último envio do número (guardado em memória no portão).

  Como as linhas `sending` contam no limite, a do próprio item é descontada (`− 1`).
- [X] T017 [US1] Na fila (`src/modules/antiban/queue.ts`), antes e depois de `waitForSlot`: se `now > item.expiresAt`, resolver como `blocked rate_limited`. O `expiresAt` é `enqueuedAt + queueMaxAgeMs`. No portão, o `blocked` vindo da fila chama:
  - `inboxRepo.blockMessage(messageId, reason)`;
  - `publish message.updated`;
  - `flagNeedsAttention`;
  - `recordSystem` com o texto "fila velha" de [contracts/conversation.md](contracts/conversation.md#registros-system-no-histórico-painel-português).

  Teste em `queue.test.ts`: um item que expira enquanto espera vaga vira `rate_limited`.
- [X] T018 [US1] Ainda no `deliverItem` do portão, antes de enviar um item `assistant`:
  - **Pausa:** se `inbox.isPaused(conversationId)`, ou se existe mensagem `operator` mais nova que `item.enqueuedAt` na conversa, resolver como `blocked superseded` (edge case e cenário US1-4).
  - **Lidas:** chamar `markMessagesRead` com as mensagens de `customerMessagesSinceLastReply` que têm `waMessageId`. Em caso de erro, log `warn` e o envio segue.
- [X] T019 [US1] Em `src/modules/whatsapp/evolution.ts`:
  - **`sendWhatsAppText(number, text, opts?: { delayMs?: number })`:** manda `delay` e `linkPreview: false` no corpo, com timeout `AbortSignal.timeout((opts?.delayMs ?? 0) + 10_000)`.
  - **`markMessagesRead(phone, waIds: string[])`:** `POST /chat/markMessageAsRead/{instance}` com `{ readMessages: [{ remoteJid: \`${phone}@s.whatsapp.net\`, fromMe: false, id }] }`, conforme [contracts/evolution.md](contracts/evolution.md). Lança `Error` com o status em caso de falha.
  - **Uso no portão:** `deliverItem` passa `delayMs: typingDelay(item.text, …)` e loga `typing_ms` (`envio liberado`).
  - **Teste:** em `src/modules/whatsapp/evolution.test.ts`, com `fetch` falso, o corpo de `sendText` e o de `markMessageAsRead`.
- [X] T020 [US1] Criar `src/modules/antiban/debounce.ts` com `createDebouncer({ delayMs, setTimeout, clearTimeout, onFire })`:
  - `push(conversationId, payload)` reinicia o temporizador da conversa e guarda o payload mais recente;
  - `onFire(conversationId, payload)` é chamado após `delayMs` de silêncio;
  - `cancel(conversationId)`.
- [X] T021 [US1] Ligar o temporizador em `src/routes/evolution-webhook.ts`. A mensagem do cliente (`!event.fromMe`, já registrada) chama `debouncer.push(conversation.id, event)` em vez de `handleMessage` direto. O `onFire` monta a mensagem combinada:
  - pega `customerMessagesSinceLastReply(conversationId)` e, se não houver nenhuma de texto, não faz nada;
  - junta os textos com `\n` num `IncomingMessage` com o `id` e o `sentAt` da última;
  - chama `handleMessage`.

  O envio do operador (`sendFromOperator` em `src/modules/inbox/service.ts`) chama `debouncer.cancel(conversationId)`. Para isso, o debouncer é exportado de `src/routes/inbox.ts` junto do portão.
- [X] T022 [US1] Regra de conversas por dia (FR-011, research.md R13): adicionar em `gate.ts` a regra `dailyConversations`. Com `servedConversationSince(conversationId, now − 24 h)` falso e `countConversationsServedSince(now − 24 h) >= conversationsPerDay`, ela devolve `{ reason: "daily_conversations", flag: true, systemText: <texto de contracts/conversation.md> }`. Testes em `src/modules/antiban/gate.test.ts` (Postgres de teste, mesmo padrão de `panel-api.test.ts`):
  - a 3ª conversa nova passa do limite 2;
  - uma conversa já atendida continua passando.
- [X] T023 [US1] Teste do ritmo de ponta a ponta no portão (`gate.test.ts`), com relógio falso e `send` falso, para o SC-002:
  - 20 `sendAssistant` simultâneos com `perMinute = 8`;
  - nenhum intervalo de 60 s tem mais de 8 chamadas a `send`;
  - todos terminam `sent` dentro de `queueMaxAgeMs`.

**Checkpoint**: US1 funciona sozinha: quickstart §1–§3.

---

## Phase 4: User Story 2 - O assistente nunca insiste nem entra em laço (Priority: P1)

**Goal**: O assistente não manda várias mensagens seguidas sem resposta, não repete texto, não manda links indevidos e para sozinho quando está falando com outro robô.

**Independent Test**: [quickstart.md §4](quickstart.md). Os testes de `assessConversation` cobrem o laço; ao vivo, uma resposta idêntica em sequência vira `blocked duplicate`.

### Tests for User Story 2

- [X] T024 [P] [US2] `src/modules/antiban/assess.test.ts`, com históricos montados à mão:
  - 3 do assistente depois do último cliente → `too_many_unanswered`;
  - 5 trocas com resposta do cliente em menos de 3 s → `loop`;
  - 5 trocas com uma resposta de 10 s no meio → `ok`;
  - 20 do assistente em 10 min → `loop`;
  - histórico normal → `ok`.
- [X] T025 [P] [US2] `src/modules/antiban/links.test.ts`:
  - na primeira resposta, remove `https://x.com/a` e `www.y.com` e põe `(link removed)`;
  - nas demais, mantém um domínio da allowlist (inclusive subdomínio) e remove os outros;
  - texto sem link fica igual;
  - não confunde `10.30` nem `e.g.` com link.

### Implementation for User Story 2

- [X] T026 [P] [US2] Criar `src/modules/antiban/assess.ts`, com `assessConversation(messages, now, config)` pura, que devolve `"ok" | "too_many_unanswered" | "loop"`, conforme research.md R5. `messages` vem de `recentForAssessment` em ordem cronológica. Nas contagens de "mensagens do assistente", só valem `origin = assistant` e `status` em `sent`/`sending`.
- [X] T027 [P] [US2] Criar `src/modules/antiban/links.ts`, com `stripLinks(text, { firstReply, allowedDomains })`, que devolve `{ text, removed: number }`, conforme research.md R7. Domínio permitido = igual a um da lista ou terminado em `.${domínio}`.
- [X] T028 [US2] Registrar no portão (`src/modules/antiban/gate.ts`) as regras da US2, nesta ordem, depois de `dailyConversations`:
  - **`assessment`:**
    - `too_many_unanswered` → `{ reason: "unanswered" }`;
    - `loop` → `{ reason: "loop", flag: true, pause: true, systemText: <laço> }`, e a pausa usa `inbox.flagNeedsAttention`, que já pausa;
  - **`duplicate`:** o mesmo texto em `lastAssistantTextsSince(conversationId, now − duplicateWindowMs)` → `{ reason: "duplicate" }`.

  Depois das regras e antes de `startOutgoing`, aplicar `stripLinks`. `firstReply` é "nenhuma mensagem `assistant` `sent` na conversa". Se `removed > 0`, log `info` com `conversationId` e `removed`.
- [X] T029 [US2] Variações das mensagens fixas (FR-017):
  - **`src/modules/scheduling/replies.ts`:** exportar `fixedTexts = { unavailable: string[], optOutConfirmation: string[], optIn: string[] }`, com os textos de [contracts/conversation.md](contracts/conversation.md#textos-ao-cliente).
  - **`src/modules/whatsapp/handle-message.ts`:** `UNAVAILABLE_MESSAGE` vira `fixedTexts.unavailable[0]`, mantido para compatibilidade dos testes.
  - **`gate.ts`:** criar `pickVariant(conversationId, options)`, que devolve a primeira variação ausente de `lastAssistantTextsSince(…, now − duplicateWindowMs)`, ou `null` se todas foram usadas.
  - **Uso:** `createRagAnswerer` e `replies.interpreterUnavailable()` continuam devolvendo o texto. O handler, ao receber um texto que é igual a um item de `fixedTexts.unavailable`, troca pela variação de `pickVariant`, e não envia nada se vier `null`.
  - **Teste:** em `gate.test.ts`, a 4ª indisponibilidade em 30 min não sai.
- [X] T030 [US2] Testes do portão para a US2 em `gate.test.ts`:
  - `loop` grava `blocked loop`, pausa e destaca a conversa e grava o registro `system`;
  - `unanswered` não destaca;
  - um link de fora da allowlist sai como `(link removed)` no texto enviado.

**Checkpoint**: US1 e US2 funcionam juntas, cada uma com seu roteiro.

---

## Phase 5: User Story 3 - O cliente pode pedir para parar (Priority: P1)

**Goal**: "parar"/"stop" gera uma única confirmação e cala o assistente para aquele telefone; "start"/"voltar" ou o operador reativam. A preferência sobrevive à limpeza das conversas.

**Independent Test**: [quickstart.md §5](quickstart.md).

### Tests for User Story 3

- [X] T031 [P] [US3] `src/modules/antiban/opt-out.test.ts`:
  - `"STOP"`, `" Parar! "`, `"não quero mais mensagens"` → saída;
  - `"não quero parar o tratamento"`, `"stop by tomorrow?"` → nada;
  - `"cancelar"` com `inSchedulingFlow: true` → nada, e com `false` → saída;
  - `"Start"`, `"quero voltar"` → volta.

### Implementation for User Story 3

- [X] T032 [P] [US3] Criar `src/modules/antiban/opt-out.ts`:
  - **`normalizeCommand(text)`:** minúsculas, NFD sem marcas diacríticas, sem pontuação e emoji nas pontas, espaços colapsados;
  - **`matchCommand(text, { inSchedulingFlow })`:** devolve `"opt_out" | "opt_in" | null`, com as listas de [contracts/conversation.md](contracts/conversation.md#palavras-de-saída-e-de-volta-fr-019-fr-021).
- [X] T033 [US3] Em `src/modules/whatsapp/handle-message.ts`, antes de `isPaused` e do roteador:
  - **`matchCommand`:** `inSchedulingFlow` vem de uma nova dependência `hasSchedulingSession(conversationId)`, ligada a `schedulingStore.getSession` em `evolution-webhook.ts`.
  - **`opt_out`:**
    - `antibanRepo.setOptedOut(phone, now)` e `inbox.recordSystem` com o texto 🚫;
    - envia uma variação de `fixedTexts.optOutConfirmation` por `gate.sendAssistant({ …, bypass: ["opted_out"] })`. A opção `bypass` do portão pula as regras listadas;
    - publica `conversation.updated`.
  - **`opt_in`:** `setOptedOut(phone, null)`, `recordSystem` ✅ e uma variação de `fixedTexts.optIn`.
  - **Já optou por sair**, sem comando: retorna sem responder.
- [X] T034 [US3] Regra `optedOut` no portão (`src/modules/antiban/gate.ts`), a primeira da lista: com `getPreference(phone)?.optedOutAt`, devolve `{ reason: "opted_out" }`, sem destacar. Teste em `gate.test.ts`: depois da saída, um `sendAssistant` grava `blocked opted_out`, e a confirmação com `bypass` sai uma única vez (SC-004).
- [X] T035 [US3] `optedOut` na conversa:
  - **`src/modules/inbox/presenters.ts`:** `presentConversation(row, optedOut = false)`;
  - **`src/modules/inbox/repository.ts`:** `listConversations` e `findConversation` fazem `left join contact_preferences on phone` e devolvem `optedOut: opted_out_at is not null`;
  - **`src/modules/inbox/service.ts`:** os pontos que publicam `conversation.updated` passam o campo.
  - **Testes:** atualizar a lista de chaves esperada em `src/routes/panel-api.test.ts` ("lista de conversas no formato do contrato").
- [X] T036 [US3] `PATCH /api/conversations/:id` em `src/routes/panel-api.ts`: o `patchBody` aceita `{ optedOut: z.literal(false) }` ou `{ assistantPaused }`, e um corpo com `optedOut: true` dá `422`. A reativação chama um novo `inbox.reactivateMessages(conversationId)`, que faz `setOptedOut(phone, null)`, `recordSystem` com "Mensagens reativadas pelo operador" e publica `conversation.updated`. O teste fica em `panel-api.test.ts`.
- [X] T037 [US3] Painel:
  - **`web/src/api.ts`:** `optedOut` em `Conversation` e `reactivateMessages(id)`, que é `PATCH { optedOut: false }`;
  - **`web/src/components/ConversationView.tsx`:** quando `optedOut`, uma faixa "O cliente pediu para não receber mensagens" com o botão "Reativar";
  - **`web/src/components/ConversationList.tsx`:** um ícone 🚫 discreto ao lado do nome;
  - **`web/src/styles.css`:** os estilos.
- [X] T038 [US3] Teste em `src/routes/panel-api.test.ts` de que `inbox.clearAll()` não apaga `contact_preferences`: depois da limpeza, uma conversa nova do mesmo telefone vem com `optedOut: true`.

**Checkpoint**: US1–US3 (todo o P1) funcionam.

---

## Phase 6: User Story 4 - O operador não escreve para contato frio sem perceber (Priority: P2)

**Goal**: O assistente nunca envia fora da janela de 24 h. O operador recebe `409` com os riscos e só envia confirmando.

**Independent Test**: [quickstart.md §6](quickstart.md).

- [X] T039 [US4] Regra `outsideWindow` no portão (`src/modules/antiban/gate.ts`), logo depois de `optedOut`: sem `lastCustomerMessageAt` ou com ela antes de `now − 24 h`, devolve `{ reason: "outside_window" }`. Teste em `gate.test.ts` com `sent_at` de 25 h atrás (SC-005).
- [X] T040 [US4] Implementar `checkOperatorRisks(conversationId)` em `gate.ts`, que devolve `cold_contact` (mesma condição de T039) e `opted_out`. O `protection_paused` entra em US5.
- [X] T041 [US4] Em `src/modules/inbox/service.ts`, `sendFromOperator` e `retry` recebem `confirmRisk: boolean`. Antes de gravar, chamam `gate.checkOperatorRisks`; havendo risco sem `confirmRisk`, lançam `new InboxError("risk_confirmation_required", { risks })`. Para isso, `InboxError` ganha esse código e um campo `details`. Em `src/routes/panel-api.ts`:
  - `sendBody` aceita `confirmRisk: z.boolean().optional()`, e o retry ganha um corpo opcional com o mesmo campo;
  - `STATUS_BY_CODE` ganha `risk_confirmation_required: 409`, e `respondWithSend` inclui `risks` no corpo do erro.
- [X] T042 [US4] Testes em `src/routes/panel-api.test.ts`:
  - conversa com cliente de 25 h atrás: sem `confirmRisk` dá `409` com `["cold_contact"]` e nada gravado, e com `confirmRisk: true` dá `201`;
  - conversa recente: `201` sem aviso;
  - cliente que saiu: `409` com `["opted_out"]`.
- [X] T043 [US4] Painel:
  - **`web/src/api.ts`:** `sendMessage(id, text, confirmRisk?)` e `retryMessage(id, confirmRisk?)`, e um `ApiError` que expõe `body.risks`;
  - **`web/src/components/RiskDialog.tsx`** (novo): um diálogo com a lista de riscos em português ("O cliente não escreve há mais de 24 horas", "O cliente pediu para não receber mensagens", "Envios automáticos pausados pela proteção"), o aviso "Enviar mesmo assim aumenta o risco de banimento do número" e os botões Cancelar e Enviar mesmo assim;
  - **`web/src/components/Composer.tsx`:** no `409 risk_confirmation_required`, abre o diálogo e, ao confirmar, repete com `confirmRisk: true`;
  - **`web/src/components/MessageBubble.tsx`:** o mesmo no reenvio.

**Checkpoint**: US4 funciona sozinha sobre a fundação.

---

## Phase 7: User Story 5 - O sistema freia sozinho quando o número dá sinais de restrição (Priority: P2)

**Goal**: Muitas falhas ou quedas pausam os envios automáticos por 30 min, com aviso no painel e retomada automática. O reenvio e o QR code têm limite de ritmo.

**Independent Test**: [quickstart.md §7 e §9](quickstart.md).

### Tests for User Story 5

- [X] T044 [P] [US5] `src/modules/antiban/breaker.test.ts`, com repositório falso e relógio falso:
  - 5 falhas em 10 min → `paused` por 30 min, com `onChange` chamado uma vez;
  - 4 falhas → nada;
  - 3 quedas em 30 min → `paused` com o motivo `connection_drops`;
  - depois de `paused_until`, `current()` limpa o estado e chama `onChange`.

### Implementation for User Story 5

- [X] T045 [P] [US5] Criar `src/modules/antiban/breaker.ts` com `createBreaker({ repo, config, now, onChange })`:
  - **`recordFailure()`:** conta `countFailedSince(now − failureWindow)` e dispara se passar do limite;
  - **`recordDrop()`:** guarda o horário em memória, mantém só os da janela e dispara;
  - **`current()`:** devolve `{ paused: boolean, pausedUntil, reason }`, limpando o estado vencido;
  - **`trip(reason)`:** `setPaused(now + pauseMs, reason)` e `onChange()`.
- [X] T046 [US5] Ligar o freio no portão (`src/modules/antiban/gate.ts`):
  - regra `paused` (a segunda, depois de `optedOut`): com `breaker.current().paused`, devolve `{ reason: "paused", flag: true, systemText: <freio> }`;
  - `deliverItem` chama `breaker.recordFailure()` quando o resultado é `failed`;
  - o `onChange` do freio, ao pausar, chama `queue.drain("paused")` (cada item drenado segue o tratamento de `blocked` de T017, com o texto do freio) e publica `protection.updated`;
  - `checkOperatorRisks` passa a incluir `protection_paused`.
- [X] T047 [US5] Quedas de conexão: em `src/routes/evolution-webhook.ts`, um `connection.update` com `state: "close"` e sem `loggedOut` chama `breaker.recordDrop()`. O freio é exportado de `src/routes/inbox.ts`.
- [X] T048 [US5] Intervalo mínimo de reenvio (FR-025) em `src/modules/inbox/service.ts`: um `Map<messageId, Date>` em memória no serviço registra a última tentativa. Se `retry` for chamado antes de `retryMinIntervalMs`, lança `InboxError("retry_too_soon", { retryAt })`, e `panel-api.ts` mapeia para `429`. Teste em `panel-api.test.ts`.
- [X] T049 [US5] Limite de QR (FR-029): em `src/modules/whatsapp/instance.ts`, guardar os horários de `prepareQr` dentro da janela e lançar `TooManyAttempts` (com `retryAt`) acima de `qrAttempts`. O `pendingQr` compartilhado conta uma vez. `src/routes/panel-api.ts` responde `429 { error: "too_many_attempts", retryAt }`. Testes em `src/modules/whatsapp/instance.test.ts` e em `panel-api.test.ts`; no painel, `web/src/pages/Connection.tsx` mostra "Muitas tentativas. Tente de novo às HH:MM".
- [X] T050 [US5] Criar `src/routes/panel-protection.ts`, com `GET /api/protection` devolvendo o `ProtectionJson`:
  - `state` e `pausedUntil`/`reason` vêm do freio;
  - `warmupUntil` e `limits` vêm de `warmupLimits` (o número conectado vem de `instance.getState().number`);
  - `usage` vem das contagens do repositório.

  A montagem do JSON fica numa função `protectionStatus()` em `gate.ts`, reusada pelo evento SSE. Registrar a rota em `src/index.ts`. Teste em `src/routes/panel-protection.test.ts` (normal, e pausado depois de `setPaused`).
- [X] T051 [US5] Painel:
  - **`web/src/api.ts`:** `getProtection()`;
  - **`web/src/components/ProtectionBanner.tsx`** (novo): nada no estado `normal`; no `paused`, a faixa de alerta "Envios automáticos pausados pela proteção (<motivo>) até HH:MM";
  - **`web/src/App.tsx`:** busca o estado ao abrir e na reconexão do SSE, atualiza no evento `protection.updated` e renderiza a faixa acima do conteúdo;
  - **`web/src/styles.css`:** os estilos.

**Checkpoint**: US5 funciona; quickstart §7 e §9.

---

## Phase 8: User Story 6 - Número novo começa devagar (aquecimento) (Priority: P3)

**Goal**: Um número conectado pela primeira vez usa limites reduzidos, que sobem ao longo de 14 dias, e o painel mostra o aquecimento.

**Independent Test**: [quickstart.md §8](quickstart.md).

- [X] T052 [US6] Em `src/routes/evolution-webhook.ts`, um `connection.update` com `state: "open"` e `number` chama `antibanRepo.rememberConnectedNumber(number, now)`. Se a linha foi criada agora (`first_connected_at` igual a `last_connected_at`), publica `protection.updated`. Fazer o mesmo em `instance.refresh()` quando ele encontra `open` com número, passando um callback `onConnected(number)` às opções de `createInstanceManager` em `src/modules/whatsapp/instance.ts`, para cobrir o servidor que sobe já conectado.
- [X] T053 [US6] No portão (`src/modules/antiban/gate.ts`), `waitForSlot`, a regra `dailyConversations` e `protectionStatus()` passam a usar `warmupLimits(config, connected?.firstConnectedAt ?? null, now)`. `connected` é lido com `getConnectedNumber(instance.getState().number)`, com cache de 60 s no portão. Teste em `gate.test.ts`: com um número conectado há 1 dia e `warmupConversationsPerDay = 2`, a 3ª conversa nova é recusada.
- [X] T054 [US6] `web/src/components/ProtectionBanner.tsx`: no estado `warmup`, uma faixa informativa e discreta, "Número em aquecimento até DD/MM: limites reduzidos (N conversas por dia)".

**Checkpoint**: Todas as histórias funcionam.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T055 [P] Atualizar [specs/002-whatsapp-web-inbox/contracts/panel-api.md](../002-whatsapp-web-inbox/contracts/panel-api.md) e [specs/002-whatsapp-web-inbox/contracts/evolution.md](../002-whatsapp-web-inbox/contracts/evolution.md) com uma nota no topo de cada um apontando para os contratos da 004, sem reescrever o conteúdo da 002.
- [X] T056 [P] Adicionar ao `README.md` uma seção "Proteção do número (anti-ban)" com:
  - o aviso de que a conexão não é oficial e a proteção só reduz o risco;
  - as recomendações fora do código: perfil com foto e descrição, nada de número virtual, esperar um dia antes de parear, pedir aos clientes que salvem o número, divulgar por link `wa.me`, manter a Evolution atualizada e de fonte oficial;
  - uma tabela curta das variáveis `ANTIBAN_*` mais prováveis de ajustar.
- [X] T057 [P] Adicionar as variáveis `ANTIBAN_*` comentadas, com o valor padrão, em `.env.example`.
- [X] T058 Rodar `grep -rn "sendWhatsAppText" src --include=*.ts` e confirmar o único chamador (convenção do topo). Conferir também que nenhum `log.*` de `src/modules/antiban/` recebe `text`.
- [X] T059 Rodar `npm run typecheck` e `npm test`; todos devem passar.
- [ ] T060 Pedir ao Filipi que valide pelo [quickstart.md](quickstart.md) §1–§9 com o WhatsApp real. A §1 confirma os endpoints da Evolution; se divergirem, ajustar só `src/modules/whatsapp/evolution.ts`. Não rodar o roteiro sem a autorização dele.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002 → T003. T004 depende de T006 só pelo tipo; pode ser feita junto de T006.
- **Foundational (Phase 2)**: depende do Setup. T005, T006 e T008 em paralelo; T007 → T009 → T010 → T011 → T012.
- **US1 (Phase 3)**: depende da fundação.
- **US2 e US3**: dependem da fundação e usam o portão de US1, porque as regras entram na mesma lista. Podem ser feitas depois de US1, ou em paralelo, se as edições em `gate.ts` forem coordenadas.
- **US4**: depende da fundação; T040 é completada por T046 (US5).
- **US5**: depende da fundação; T046 usa a fila de US1 (`drain`).
- **US6**: depende de US1 (`waitForSlot`, `dailyConversations`) e de US5 (`protectionStatus`, faixa).
- **Polish**: depois das histórias desejadas.

### Ordem das regras no portão (final)

`optedOut` → `paused` → `outsideWindow` → `dailyConversations` → `assessment` → `duplicate` → links (transformação) → fila. A confirmação de saída e a de volta usam `bypass` para as regras que as impediriam.

### Within Each User Story

- Os testes das funções puras ([P]) antes ou junto da função.
- Função pura → regra no portão → rota → painel.

### Parallel Opportunities

- **Fase 2:** T005, T006 e T008.
- **US1:** T013, T014 e T015 juntos; T019 (evolution.ts) e T020 (debounce.ts) em paralelo depois de T016.
- **US2:** T024, T025, T026 e T027 juntos.
- **US3:** T031 e T032 juntos; T037 (painel) em paralelo com T034–T036 (servidor).
- **US5:** T044 e T045 juntos; T049 (instance.ts) e T051 (painel) em paralelo com T046–T048.
- **Polish:** T055, T056 e T057.

---

## Parallel Example: User Story 2

```text
Task: "T024 assess.test.ts — históricos de unanswered, loop e ok"
Task: "T025 links.test.ts — primeira resposta, allowlist, falsos positivos"
Task: "T026 assess.ts — assessConversation pura"
Task: "T027 links.ts — stripLinks"
# depois, em sequência no mesmo arquivo:
Task: "T028 regras assessment e duplicate + stripLinks no gate.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 + Phase 2: todo envio passa pelo portão.
2. Phase 3 (US1): ritmo humano, juntar mensagens, limites e fila. É o que mais reduz o risco no uso diário.
3. **Parar e validar** com quickstart §1–§3.

### Incremental Delivery

1. US1 → US2 (laços, repetição, links) → US3 (saída): conclui o P1.
2. US4 (operador fora da janela) e US5 (freio): o P2.
3. US6 (aquecimento): só importa ao trocar de número.

---

## Notes

- Cada tarefa cita o arquivo; tarefas no mesmo arquivo (`gate.ts`, `panel-api.ts`, `service.ts`) não são [P] entre si.
- Fazer commit por história, seguindo o padrão de mensagens do Secretaryfy (em português, como o histórico).
- O portão é a única peça que conhece todas as regras; as funções puras não sabem do banco.
- **Desvios da implementação** (registrados em research.md e data-model.md):
  - a janela de envios por minuto e por hora fica em memória no portão, semeada do banco, e as falhas do freio também ficam em memória (research.md R2, R11);
  - as preferências de saída ficam no repositório do inbox, e não no da proteção;
  - os textos com variações ficam em `src/modules/antiban/texts.ts`, para evitar um import circular com `replies.ts`;
  - o envio do operador espera a fila e responde já com o status final.
