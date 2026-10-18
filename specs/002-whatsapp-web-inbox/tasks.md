---

description: "Task list for 002-whatsapp-web-inbox"
---

# Tasks: Painel web do WhatsApp

**Input**: Design documents from `/specs/002-whatsapp-web-inbox/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/panel-api.md](contracts/panel-api.md), [contracts/evolution.md](contracts/evolution.md), [quickstart.md](quickstart.md)

**Tests**: Incluídos para o servidor, como define o plano ([research.md R12](research.md#r12-testes)). Os testes `node:test` não usam rede nem banco; os do repositório só rodam com `DATABASE_URL_TEST`. O painel (`web/`) não tem testes automatizados: é validado por `tsc` e pelo [quickstart.md](quickstart.md).

**Organization**: Uma fase por user story. A US5 (login) vem antes das outras porque a spec a coloca como pré-requisito de todas. O registro das mensagens no banco (FR-001 a FR-005) fica na fase Foundational, porque toda story depende dele.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1–US5, conforme a [spec](spec.md)

## Path Conventions

- Servidor: `src/` (código e comentários em português, imports com sufixo `.js`, como no projeto)
- Painel: `web/` (SPA React; as dependências ficam no `package.json` da raiz)
- Testes do servidor: `src/**/*.test.ts`, rodados com `npm test`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependências, configuração e esqueleto do painel.

- [X] T001 Rodar o [quickstart.md §0](quickstart.md#0-conferir-os-nomes-da-evolution-api) contra a Evolution API real e conferir o formato de `connectionState`, `fetchInstances`, `connect` e `webhook/set` e os nomes dos eventos. Registrar qualquer diferença em [contracts/evolution.md](contracts/evolution.md) antes de seguir. Se a Evolution API não estiver acessível, registrar isso em `contracts/evolution.md` como "não verificado" e seguir. *(2026-10-16: Evolution API indisponível nesta máquina; registrado como não verificado em contracts/evolution.md)*
- [X] T002 Instalar com versões exatas: `npm install --save-exact @fastify/cookie@11.1.2 @fastify/static@10.1.5 react@19.3.0 react-dom@19.3.0` e `npm install --save-exact -D vite@8.3.1 @vitejs/plugin-react@6.1.1 @types/react@19.3.0 @types/react-dom@19.3.0`. Conferir com `npm ls` que não há peer dependency faltando.
- [X] T003 [P] Em `src/config/env.ts`, acrescentar `OPERATOR_PASSWORD: z.string().min(12, "OPERATOR_PASSWORD deve ter pelo menos 12 caracteres").optional()` e `DATABASE_URL_TEST: z.url().optional()`. Em `.env.example`, acrescentar a seção `# Painel web` com `OPERATOR_PASSWORD=`, um comentário dizendo que sem ela o painel fica desligado, e `# DATABASE_URL_TEST=postgres://secretaryfy:secretaryfy@localhost:5432/secretaryfy_test`. Em `src/test/setup-env.ts`, acrescentar `OPERATOR_PASSWORD: "test-operator-password"`.
- [X] T004 [P] Criar o esqueleto do painel:
  - `web/index.html`: `lang="pt-BR"`, `<div id="root">` e `<script type="module" src="/src/main.tsx">`.
  - `web/vite.config.ts`: `root` em `web/`, plugin react, `build.outDir` em `dist` e `server.proxy` de `/api` para `http://localhost:3000`, sem buffering para o SSE.
  - `web/tsconfig.json`: `lib` `["ES2023","DOM","DOM.Iterable"]`, `jsx: "react-jsx"`, `moduleResolution: "bundler"`, `strict`, `noEmit` e `include: ["src"]`.
  - `web/src/main.tsx`: renderiza `<App />`.
  - `web/src/App.tsx`: provisório, só com o título "Secretaryfy".
- [X] T005 [P] Em `package.json`, acrescentar os scripts:
  - `"dev:web": "vite --config web/vite.config.ts"`
  - `"build:web": "tsc -p web && vite build --config web/vite.config.ts"`
  - `"build"` passa a ser `"tsc && npm run build:web"`
  - `"typecheck"` passa a ser `"tsc --noEmit && tsc -p web"`

  Em `.gitignore`, acrescentar `web/dist/`.
- [X] T006 [P] Criar `web/src/styles.css` com variáveis de cor em `:root`, o tema escuro em `@media (prefers-color-scheme: dark)` e o layout base: barra superior com o status da conexão, uma coluna de conversas de 320 px e a conversa ocupando o resto da largura.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Gravar no banco todas as mensagens (FR-001 a FR-005) e ter a base de eventos, apresentação e cliente HTTP do painel. Toda story depende disto.

**⚠️ CRITICAL**: Nenhuma story começa antes desta fase.

### Tests for Foundational

- [X] T007 [P] Escrever `src/modules/whatsapp/evolution.test.ts`, substituindo os testes atuais, para `parseEvolutionEvent(body)`:
  - **`messages.upsert` vindo do cliente**: devolve `{ kind: "message", id, phone, pushName, fromMe: false, type: "text", text, sentAt }`, com `sentAt` calculado de `messageTimestamp`.
  - **Tipos de mídia**: um caso para cada linha da tabela de tipos de [contracts/evolution.md](contracts/evolution.md), incluindo a legenda de imagem e de vídeo.
  - **`fromMe: true`**: devolve `fromMe: true`.
  - **`send.message`**: tratado como `messages.upsert`.
  - **`connection.update`**: devolve `{ kind: "connection", state, number }`, com `number` extraído de `wuid`.
  - **`qrcode.updated`**: devolve `{ kind: "qrcode", qr }`.
  - **Devolvem `null`**: grupo, sem `key.id`, texto só com espaços, `reactionMessage`, `protocolMessage` e evento desconhecido.
- [X] T008 [P] Escrever `src/modules/inbox/presenters.test.ts`:
  - `mediaLabel(type)` devolve os rótulos de [data-model.md](data-model.md#rótulos-de-mídia-prévia-e-histórico);
  - `previewOf({ type, text })` usa o texto ou "rótulo — legenda" e corta em 120 caracteres;
  - `presentConversation` e `presentMessage` geram exatamente os campos de [contracts/panel-api.md](contracts/panel-api.md), com as datas em ISO.
- [X] T009 [P] Escrever `src/modules/inbox/events.test.ts`: `subscribe(listener)` recebe o que `publish(event)` envia; a função devolvida por `subscribe` cancela a assinatura; `subscriberCount()` acompanha as assinaturas.
- [X] T010 [P] Escrever `src/modules/inbox/service.test.ts`, com um repositório falso em memória, para a regra de eco de [research.md R6](research.md#r6-eco-das-mensagens-enviadas): *(Feito com o repositório real sobre Postgres em memória (PGlite), em vez de um repositório falso, para testar o SQL de verdade)*
  - **Mensagem do cliente**: grava com `received`, soma 1 em `unread_count`, atualiza a prévia e publica `message.created` e `conversation.updated`.
  - **Mesmo `id` duas vezes**: grava uma vez só e devolve `{ created: false }`.
  - **`fromMe` com ID que já existe**: é ignorado.
  - **`fromMe` com ID desconhecido e uma linha `sending` de mesmo texto há menos de 60 s**: anexa o ID a essa linha e marca `sent`.
  - **`fromMe` sem correspondente**: grava com `origin = phone`.
  - **`pushName` em mensagem `fromMe`**: não altera o nome da conversa.
- [X] T011 [P] Escrever `src/modules/inbox/repository.test.ts`, que só roda quando `DATABASE_URL_TEST` está definida (`test.skip` caso contrário) e aplica as migrations antes. Casos: *(Sem DATABASE_URL_TEST, roda num PGlite em memória (src/test/db.ts) em vez de ser pulado)*
  - `upsertConversation` por telefone;
  - `insertMessage` com conflito de `wa_message_id`, que devolve `null`;
  - `listConversations` ordenada e filtrada por `q`;
  - `listMessages` com cursor `before` e `hasMore`;
  - `findPendingEcho` respeitando a janela de 60 s.

### Implementation for Foundational

- [X] T012 Em `src/db/schema.ts`, acrescentar os enums `messageOrigin`, `messageType` e `messageStatus` (`pgEnum`) e as tabelas `conversations` e `messages`, exatamente como em [data-model.md](data-model.md), com o índice `conversations_last_message_at_idx` e o índice composto `messages_conversation_sent_at_idx`. Rodar `npm run db:generate`, conferir o SQL gerado em `drizzle/0001_*.sql` e aplicar com `npm run db:migrate`.
- [X] T013 [P] Criar `src/modules/inbox/events.ts`:
  - o tipo `InboxEvent`, uma união dos quatro eventos de [contracts/panel-api.md](contracts/panel-api.md#get-apievents);
  - `publish(event)`, `subscribe(listener)` (devolve a função que cancela a assinatura) e `subscriberCount()`;
  - por baixo, um `EventEmitter` com `setMaxListeners(0)`.
- [X] T014 [P] Criar `src/modules/inbox/presenters.ts` com `mediaLabel`, `previewOf`, `presentConversation(row)` e `presentMessage(row)`, conforme T008.
- [X] T015 Criar `src/modules/inbox/repository.ts`. Ele recebe `db` por parâmetro (`createInboxRepository(db)`) e expõe:
  - `upsertConversation({ phone, name })`, que só atualiza `name` quando ele vier preenchido;
  - `findConversation(id)` e `findConversationByPhone(phone)`;
  - `insertMessage(values)`, com `onConflictDoNothing({ target: messages.waMessageId })`, devolvendo a linha ou `null`;
  - `updateMessage(id, patch)`;
  - `findMessageByWaId(waId)`;
  - `findPendingEcho(conversationId, text, since)`, que procura `status = 'sending'`, mesmo texto e `created_at >= since`;
  - `touchConversation(id, { lastMessageAt, lastMessagePreview, incrementUnread })`;
  - `listConversations({ q, limit: 100 })`, filtrando `name` ou `phone` com `ILIKE %q%`;
  - `listMessages(conversationId, { before, limit })`, com cursor `(sent_at, id)` e uma linha a mais para calcular `hasMore`, devolvendo em ordem cronológica;
  - `setPaused(id, paused)`, `markRead(id)` e `transaction(fn)`.
- [X] T016 Criar `src/modules/inbox/service.ts` com `createInboxService({ repo, publish, now = Date.now })`, que expõe:
  - `recordIncoming(parsed)`: o fluxo "Mensagem do cliente" e a regra de eco de [data-model.md](data-model.md#fluxos-que-mudam-dados). Devolve `{ created, conversation, message }`.
  - `startOutgoing({ conversationId, origin, text, pause })`: insere com `sending`; com `pause: true`, grava `assistant_paused = true` na mesma transação. Publica `message.created`.
  - `finishOutgoing(messageId, result)`: com `{ waId }`, marca `sent`; com `{ error }`, marca `failed`. Também atualiza `touchConversation` e publica `message.updated` e `conversation.updated`.
  - `isPaused(conversationId)`.

  Fazer os testes T010 passarem.
- [X] T017 Em `src/modules/whatsapp/evolution.ts`:
  - **Parser**: substituir `parseIncomingMessage` por `parseEvolutionEvent(body)`, que devolve `IncomingMessage | ConnectionEvent | QrCodeEvent | null`, conforme [contracts/evolution.md](contracts/evolution.md). `IncomingMessage` ganha os campos `fromMe`, `type` e `sentAt: Date`, e `text` passa a ser `string | null`.
  - **Envio**: `sendWhatsAppText` passa a devolver `Promise<{ waId: string }>`, com o `key.id` da resposta da Evolution API.

  Fazer os testes T007 passarem.
- [X] T018 Em `src/modules/whatsapp/handle-message.ts`, trocar a dependência `seen` por `inbox: { isPaused, startOutgoing, finishOutgoing }`. O handler passa a receber `{ conversationId, message }` e segue estes passos:
  1. Se `inbox.isPaused(conversationId)` for verdadeiro, ou se a mensagem não for texto, retorna sem fazer nada.
  2. Chama `ask`. Se falhar, a resposta passa a ser a `UNAVAILABLE_MESSAGE`.
  3. Consulta `isPaused` de novo. Se a conversa foi pausada nesse meio-tempo, descarta a resposta e registra `log.info` com "resposta descartada: conversa pausada" (FR-022b).
  4. `startOutgoing({ origin: "assistant" })`, depois `send`, depois `finishOutgoing` com o `waId` ou com o erro.

  Atualizar `src/modules/whatsapp/handle-message.test.ts`, trocando o dedupe por um inbox falso. Manter os casos de resposta, indisponibilidade e falha de envio, e acrescentar dois: pausado antes de perguntar (não chama `ask`) e pausado durante a resposta (não chama `send`).
- [X] T019 Apagar `src/modules/whatsapp/dedupe.ts` e `src/modules/whatsapp/dedupe.test.ts`. Confirmar com `grep` que nada mais importa `dedupe`.
- [X] T020 Reescrever `src/routes/evolution-webhook.ts`:
  - montar `inbox = createInboxService({ repo: createInboxRepository(db), publish })` e o `handleMessage` com `inbox`;
  - depois de validar o token e responder 200, processar em segundo plano: `kind: "message"` → `inbox.recordIncoming(parsed)`, e se `created && !fromMe` → `handleMessage(...)`; `connection` e `qrcode` → `instance.applyEvent(parsed)`, que vem na T050 e por enquanto é uma função vazia em `src/modules/whatsapp/instance.ts`;
  - erros vão para `req.log.error`.
- [X] T021 [P] Criar `web/src/api.ts`:
  - os tipos `Conversation`, `Message` e `Connection`, iguais ao contrato;
  - `request<T>(method, path, body?)`, com `credentials: "same-origin"`, JSON e a classe `ApiError` com `status` e `error`;
  - uma função por rota de [contracts/panel-api.md](contracts/panel-api.md): `login`, `getSession`, `logout`, `getConnection`, `requestQr`, `disconnect`, `listConversations`, `listMessages`, `markRead`, `setPaused`, `sendMessage` e `retryMessage`.
- [X] T022 [P] Criar `web/src/format.ts`:
  - `formatPhone`, conforme a nota do [plan.md](plan.md#implementation-notes);
  - `formatTime`, que mostra a hora se for hoje e a data curta nos outros casos, com `Intl.DateTimeFormat("pt-BR")`;
  - `originLabel`: Cliente, Assistente, Operador, Celular;
  - `mediaLabel`, igual ao do servidor.
- [X] T023 Rodar `npm test` e `npm run typecheck`. Enviar ao webhook, com `curl`, um evento `messages.upsert` de texto e o mesmo evento outra vez, e conferir no banco (`select * from messages`) que existe uma única linha `customer` e uma `assistant` com o assistente RAG no ar. *(Validado com PGlite servido por socket e Evolution API simulada)*

**Checkpoint**: Toda mensagem fica gravada, sem duplicatas, e o assistente da feature 001 continua respondendo.

---

## Phase 3: User Story 5 - Só o operador acessa o painel (Priority: P1)

**Goal**: Login com senha única; nenhuma rota `/api/*` responde sem sessão.

**Independent Test**: [quickstart.md §2](quickstart.md#2-acesso-us5-sc-007).

### Tests for User Story 5

- [X] T024 [P] [US5] Escrever `src/modules/auth/login-limiter.test.ts`, com `now` injetado:
  - 5 falhas do mesmo IP bloqueiam a 6ª tentativa, e `retryAfterS` diminui com o tempo;
  - outro IP não é afetado;
  - depois de 15 min, o IP é liberado;
  - um sucesso zera as falhas daquele IP.
- [X] T025 [P] [US5] Escrever `src/modules/auth/session.test.ts`:
  - `checkPassword` aceita a senha certa e recusa outra do mesmo tamanho e outra de tamanho diferente;
  - `createSessionToken` e `verifySessionToken` funcionam juntos;
  - um token adulterado e um token expirado são recusados.
- [X] T026 [P] [US5] Escrever `src/routes/panel-session.test.ts` com `app.inject` num Fastify montado só com `@fastify/cookie` e as rotas de sessão:
  - **Senha certa**: 204 com `Set-Cookie` `sf_session` HttpOnly e SameSite=Strict.
  - **Senha errada**: 401 `invalid_credentials`.
  - **Sexta falha seguida**: 429.
  - **`GET /api/session`**: 200 com o cookie e 401 sem ele.
  - **`DELETE /api/session`**: apaga o cookie.
  - **Hook de autenticação**: uma rota protegida responde 401 sem cookie.
  - **`POST` sem JSON**: 415.
  - **Sem `OPERATOR_PASSWORD`** (`createPanelAuth({ password: undefined })`): todas as rotas respondem 503 `panel_disabled`.

### Implementation for User Story 5

- [X] T027 [P] [US5] Criar `src/modules/auth/login-limiter.ts` com `createLoginLimiter({ maxFailures = 5, windowMs = 15 * 60_000, now = Date.now })`, que expõe `check(ip)` → `{ allowed, retryAfterS }`, `fail(ip)` e `succeed(ip)`, guardando os dados num `Map` por IP.
- [X] T028 [P] [US5] Criar `src/modules/auth/session.ts`:
  - `SESSION_COOKIE = "sf_session"` e `SESSION_TTL_S = 43200`;
  - `checkPassword(given, expected)`, com `timingSafeEqual` sobre o SHA-256 das duas senhas;
  - `createSessionToken()`, que chama `sign("operator", SESSION_TTL_S)` de `src/config/crypto.ts`;
  - `verifySessionToken(token)`, que confere se `verifySigned(token) === "operator"`;
  - `cookieOptions(publicUrl)`, que devolve `{ httpOnly, sameSite: "strict", path: "/", secure: publicUrl.startsWith("https"), maxAge: SESSION_TTL_S }`.
- [X] T029 [US5] Criar `src/routes/panel-session.ts`:
  - **Plugin**: `panelAuth(app, { password })` registra `POST`, `GET` e `DELETE` de `/api/session` e um `onRequest` hook que vale para todo `/api/*`.
  - **Painel desligado**: sem senha, o hook responde 503 `panel_disabled` antes de qualquer outra checagem.
  - **Sessão**: a não ser em `/api/session`, o hook exige um cookie válido e responde 401 `unauthenticated` quando falta.
  - **Corpo**: nos `POST`, `PATCH` e `DELETE` com corpo, exige `application/json` e responde 415 quando não for.
  - **Login**: `POST /api/session` usa o limiter com `req.ip`; sucesso responde 204 e grava o cookie; falha responde 401 `invalid_credentials`.
  - **Log**: nunca registra a senha.
- [X] T030 [US5] Em `src/index.ts`, registrar `@fastify/cookie` e o plugin `panelAuth` com `{ password: env.OPERATOR_PASSWORD }`, antes das outras rotas `/api`. Quando a senha não estiver definida, registrar no log `warn` "painel desativado: defina OPERATOR_PASSWORD".
- [X] T031 [P] [US5] Criar `web/src/pages/Login.tsx`: formulário com campo de senha e botão "Entrar". Para 401, mostra "Senha inválida"; para 429, "Muitas tentativas. Tente de novo em N min". Com sucesso, chama `onLoggedIn()`.
- [X] T032 [P] [US5] Criar `web/src/pages/Disabled.tsx`, a tela mostrada quando a API responde 503 `panel_disabled`, com o texto "Painel desativado: defina OPERATOR_PASSWORD no .env do servidor e reinicie".
- [X] T033 [US5] Em `web/src/App.tsx`, implementar o estado de sessão:
  - **Ao abrir**: chama `getSession()`; 401 leva ao `Login`, 503 leva ao `Disabled` e 200 abre o painel (por enquanto um placeholder com o botão "Sair", que chama `logout()` e volta ao login).
  - **Durante o uso**: qualquer `ApiError` 401 volta para o login.
- [X] T034 [US5] Rodar `npm test` e validar o [quickstart.md §2](quickstart.md#2-acesso-us5-sc-007). *(Validado no navegador (Playwright) com Evolution API simulada)*

**Checkpoint**: O painel só abre com a senha.

---

## Phase 4: User Story 1 - Acompanhar as conversas (Priority: P1) 🎯 MVP

**Goal**: Lista e histórico das conversas, com atualização em tempo real.

**Independent Test**: [quickstart.md §4](quickstart.md#4-acompanhar-conversas-us1-sc-001-sc-004).

### Tests for User Story 1

- [X] T035 [P] [US1] Escrever `src/routes/panel-api.test.ts` com `app.inject` e o inbox falso, já autenticado por um cookie de teste:
  - `GET /api/conversations` devolve o formato do contrato e repassa `q`;
  - `GET /api/conversations/:id/messages` repassa `before` e `limit` (o máximo é 100) e responde 404 para um ID inexistente;
  - `POST /api/conversations/:id/read` responde 204 e publica `conversation.updated`.
- [X] T036 [P] [US1] Escrever `src/routes/panel-events.test.ts`. Com o Fastify escutando numa porta 0 e um cookie válido, abrir `GET /api/events` usando `fetch` e ler o stream. Conferir:
  - o `Content-Type: text/event-stream`;
  - que um `publish({ type: "message.created", ... })` chega no formato `event: message.created\ndata: {...}\n\n`;
  - que, ao fechar o stream, `subscriberCount()` volta a 0;
  - que sem cookie a resposta é 401.

### Implementation for User Story 1

- [X] T037 [US1] Criar `src/routes/panel-api.ts` com um plugin que recebe `{ inbox, repo }`. Registrar `GET /api/conversations`, `GET /api/conversations/:id/messages` e `POST /api/conversations/:id/read`, conforme [contracts/panel-api.md](contracts/panel-api.md), validando `params` e `querystring` com zod e usando `presenters`. Registrar em `src/index.ts`.
- [X] T038 [US1] Criar `src/routes/panel-events.ts` com `GET /api/events`:
  - `reply.hijack()` e os cabeçalhos `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive` e `x-accel-buffering: no`;
  - `subscribe`, escrevendo `event:` e `data:` para cada evento;
  - `: ping\n\n` a cada 25 s;
  - no `close` da requisição, cancela a assinatura e o intervalo.

  Registrar em `src/index.ts`.
- [X] T039 [P] [US1] Criar `web/src/useEvents.ts`. O hook `useEvents(handlers)` abre um `EventSource("/api/events")`, registra um listener por tipo de evento e expõe `status`: `connecting`, `open` ou `reconnecting`. No `onopen` que vem depois de um `onerror`, chama `handlers.onReconnect()`. Fecha a conexão ao desmontar.
- [X] T040 [P] [US1] Criar `web/src/components/ConversationList.tsx`:
  - campo de busca com debounce de 250 ms, que chama `listConversations(q)`;
  - um item por conversa, com o nome ou o `formatPhone`, a prévia, `formatTime` e a contagem de não lidas quando for maior que 0;
  - o item selecionado fica destacado;
  - estado vazio "Nenhuma conversa ainda".
- [X] T041 [P] [US1] Criar `web/src/components/MessageBubble.tsx`:
  - **Lado**: as mensagens de `customer` à esquerda; as de `assistant`, `operator` e `phone` à direita, com cores diferentes por origem.
  - **Conteúdo**: `originLabel`, o texto com `white-space: pre-wrap`, o rótulo de mídia quando `type` não é `text`, o horário e o status (⏳ `sending`, ✓ `sent`, ⚠️ `failed` com o `error` no `title`).
  - **Reenvio**: deixa uma prop `onRetry`, que vai ser usada na US2.
- [X] T042 [US1] Criar `web/src/components/ConversationView.tsx`:
  - **Cabeçalho**: nome ou telefone; o espaço para o status do assistente fica para a US4.
  - **Histórico**: carrega `listMessages(id)` e rola até o fim.
  - **Mensagens antigas**: ao chegar no topo, chama `listMessages(id, { before: primeira.id })` com `hasMore` e preserva a posição da rolagem.
  - **Leitura**: chama `markRead(id)` ao abrir e a cada `message.created` de `customer` com a conversa aberta.
  - **Tempo real**: recebe `message.created` e `message.updated` por props, juntando as mensagens pelo `id`.
- [X] T043 [US1] Criar `web/src/pages/Inbox.tsx`, que junta `ConversationList` e `ConversationView` e usa `useEvents`:
  - `conversation.updated` faz upsert na lista e reordena por `lastMessageAt`;
  - `message.created` e `message.updated` são repassados para a conversa aberta;
  - `onReconnect` busca de novo a lista e a conversa aberta;
  - mostra o aviso "Reconectando…" enquanto `status === "reconnecting"`.

  Em `web/src/App.tsx`, trocar o placeholder pelo `Inbox`.
- [X] T044 [US1] Rodar `npm test` e `npm run typecheck` e validar o [quickstart.md §4](quickstart.md#4-acompanhar-conversas-us1-sc-001-sc-004). A mensagem do cliente deve aparecer em até 5 s, e a contagem de mensagens no celular e no painel deve ser igual. *(Validado no navegador com Evolution API simulada: mensagem nova aparece sem recarregar, eco sem duplicata)*

**Checkpoint**: MVP. O operador acompanha as conversas em tempo real.

---

## Phase 5: User Story 2 - Mandar mensagens pelo painel (Priority: P1)

**Goal**: Envio e reenvio de mensagens do operador.

**Independent Test**: [quickstart.md §5](quickstart.md#5-enviar-e-assumir-us2-us4-sc-002-sc-005), linhas de envio, falha e desconexão.

### Tests for User Story 2

- [X] T045 [P] [US2] Acrescentar a `src/routes/panel-api.test.ts`, com `send` falso e o estado da conexão falso:
  - **Envio com sucesso**: 201 com `status: sent`, e `startOutgoing` recebe `origin: "operator"` e `pause: true`.
  - **Texto vazio ou só com espaços**: 422, sem gravar nada.
  - **Texto com mais de 4096 caracteres**: 422.
  - **WhatsApp desconectado**: 409 `whatsapp_disconnected`, sem gravar nada.
  - **`send` falhando**: 502 com `status: failed`.
  - **`POST /api/messages/:id/retry`** numa mensagem `failed` do operador: 200 com `sent`.
  - **Retry inválido** (mensagem do assistente ou já `sent`): 409.

### Implementation for User Story 2

- [X] T046 [US2] Em `src/modules/inbox/service.ts`, acrescentar:
  - `sendFromOperator(conversationId, text, { send, isConnected })`: confere a conexão, chama `startOutgoing({ origin: "operator", pause: true })`, depois `send` e `finishOutgoing`, e devolve a mensagem final;
  - `retry(messageId, deps)`: valida `origin = operator` e `status = failed`, muda para `sending`, publica `message.updated`, envia e chama `finishOutgoing`.

  Acrescentar os casos correspondentes a `src/modules/inbox/service.test.ts`.
- [X] T047 [US2] Em `src/routes/panel-api.ts`, registrar `POST /api/conversations/:id/messages` e `POST /api/messages/:id/retry`, conforme o contrato. O texto passa por `z.string().trim().min(1).max(4096)`, e `isConnected` vem de `instance.getState().state === "open"`, usando a função provisória da T020.
- [X] T048 [US2] Criar `web/src/components/Composer.tsx` e ligar em `ConversationView`:
  - **Campo**: `textarea` com altura automática; Enter envia, Shift+Enter quebra a linha.
  - **Envio**: o botão fica desligado com texto vazio, e o campo é limpo só depois de 201.
  - **Erros**: 409 `whatsapp_disconnected` mostra o aviso "WhatsApp desconectado: a mensagem não foi enviada" e mantém o texto; um 502 traz a mensagem `failed`, que aparece no histórico.
  - **Reenvio**: o `onRetry` do `MessageBubble` chama `retryMessage`.
- [X] T049 [US2] Rodar `npm test` e validar as linhas de envio, falha e reenvio do [quickstart.md §5](quickstart.md#5-enviar-e-assumir-us2-us4-sc-002-sc-005). A mensagem deve chegar ao cliente em até 5 s. *(Validado no navegador: envio, falha com a Evolution fora do ar e reenvio)*

**Checkpoint**: O operador lê e responde pelo painel.

---

## Phase 6: User Story 3 - Conectar o WhatsApp pelo painel (Priority: P2)

**Goal**: Status em todas as telas, QR code que se renova, desconexão e webhook configurado automaticamente.

**Independent Test**: [quickstart.md §3](quickstart.md#3-conexão-us3-sc-003).

### Tests for User Story 3

- [X] T050 [P] [US3] Escrever `src/modules/whatsapp/instance.test.ts`, com `fetch` falso (injetado em `createInstanceManager({ fetch, publish, setInterval })`):
  - **`applyEvent`**: um `connection.update` com `open` define o número e apaga o QR code; um `qrcode.updated` guarda o QR code. Os dois publicam `connection.updated`.
  - **`prepareQr`**: com 404 no `connectionState`, chama `instance/create`, depois `webhook/set` com a URL, o token e os 4 eventos, e depois `connect`. Já conectado, lança `AlreadyConnected`.
  - **`logout`**: chama `DELETE /instance/logout`.
  - **`refresh`**: lê `connectionState` e `fetchInstances`.
  - **Polling**: começa quando `startPolling` é chamado com assinantes e para em `stopPolling`.
  - **Erros**: um status diferente de 2xx vira `EvolutionError`.

### Implementation for User Story 3

- [X] T051 [US3] Implementar `src/modules/whatsapp/instance.ts`, substituindo o provisório da T020:
  - `createInstanceManager({ fetch, publish, env, setInterval, clearInterval })`, com o estado `{ state, number, qr }`;
  - `getState()`, `applyEvent(ev)`, `refresh()`, `prepareQr()`, `logout()`, `startPolling()` e `stopPolling()` (a cada 10 s), além das classes `EvolutionError` e `AlreadyConnected`;
  - as chamadas e os corpos de [contracts/evolution.md](contracts/evolution.md#chamadas-feitas-pelo-secretaryfy), com o header `apikey`;
  - exportar a instância padrão `instance`.

  Fazer os testes T050 passarem.
- [X] T052 [US3] Em `src/routes/panel-api.ts`, registrar as rotas de conexão:
  - `GET /api/connection`, que chama `refresh()` se o estado nunca foi lido;
  - `POST /api/connection/qr`: `AlreadyConnected` vira 409 e `EvolutionError` vira 502 `evolution_unavailable`;
  - `DELETE /api/connection`.

  Em `src/routes/panel-events.ts`, chamar `instance.startPolling()` quando `subscriberCount()` passar de 0 para 1 e `stopPolling()` quando voltar a 0. Em `src/index.ts`, chamar `instance.refresh()` na subida, sem bloquear: uma falha só gera um aviso no log.
- [X] T053 [P] [US3] Criar `web/src/components/ConnectionBadge.tsx`, que mostra na barra superior "Conectado · +55 11 98888-7777", "Conectando…" ou "Desconectado" (com link para a tela de conexão), e recebe as atualizações de `connection.updated`.
- [X] T054 [US3] Criar `web/src/pages/Connection.tsx`:
  - **Desconectado**: chama `requestQr()`, mostra a imagem e as instruções ("No celular: WhatsApp > Aparelhos conectados > Conectar aparelho"), e pede um QR code novo a cada 30 s enquanto o estado não for `open`. Um 502 mostra "Evolution API indisponível" com o botão "Tentar de novo".
  - **Conectado**: mostra o número e o botão "Desconectar", que pede confirmação antes.
  - **Mudança de estado**: reage ao `connection.updated`.
- [X] T055 [US3] Em `web/src/App.tsx` e `web/src/pages/Inbox.tsx`:
  - mostrar a barra superior com `ConnectionBadge`, o link "Conversas / Conexão" e "Sair" em todas as telas logadas;
  - controlar a navegação com um estado `view` (`inbox` ou `connection`) e o hash da URL (`#/conexao`);
  - buscar `getConnection()` ao abrir o painel e ao reconectar;
  - repassar ao `Composer` se a conexão está aberta, desligando o envio quando o estado não for `open` (FR-014).
- [X] T056 [US3] Rodar `npm test` e validar o [quickstart.md §3](quickstart.md#3-conexão-us3-sc-003) com o celular de teste. *(Validado com Evolution API simulada (logout, webhook/set, connect, connection.update); falta o celular real)*

**Checkpoint**: O número é conectado e desconectado pelo painel, sem passar pela Evolution API.

---

## Phase 7: User Story 4 - Assumir a conversa no lugar do assistente (Priority: P2)

**Goal**: Pausar e reativar o assistente por conversa, com a pausa automática ao enviar (FR-022a), que já é gravada desde a T046.

**Independent Test**: [quickstart.md §5](quickstart.md#5-enviar-e-assumir-us2-us4-sc-002-sc-005), linhas de pausa.

### Tests for User Story 4

- [X] T057 [P] [US4] Acrescentar a `src/routes/panel-api.test.ts`:
  - `PATCH /api/conversations/:id` com `{ assistantPaused: true }` responde 200, chama `setPaused` e publica `conversation.updated`;
  - um corpo inválido responde 422.

  Acrescentar a `src/modules/inbox/service.test.ts`: `sendFromOperator` deixa `isPaused` verdadeiro.

### Implementation for User Story 4

- [X] T058 [US4] Em `src/modules/inbox/service.ts`, acrescentar `setAssistantPaused(conversationId, paused)`, que grava e publica `conversation.updated`. Em `src/routes/panel-api.ts`, registrar `PATCH /api/conversations/:id` com `z.object({ assistantPaused: z.boolean() })`.
- [X] T059 [US4] Em `web/src/components/ConversationView.tsx`, mostrar no cabeçalho o estado do assistente: "Assistente ativo" com o botão "Pausar", ou "Assistente pausado" com o botão "Reativar". O botão chama `setPaused`, e a tela se atualiza com o `conversation.updated`. Em `ConversationList`, marcar com um ícone ⏸ as conversas pausadas.
- [X] T060 [US4] Rodar `npm test` e validar as linhas de pausa do [quickstart.md §5](quickstart.md#5-enviar-e-assumir-us2-us4-sc-002-sc-005): enviar pausa, o cliente pergunta e não há resposta automática, reativar volta a responder, e as outras conversas não são afetadas (SC-005). *(Validado: pausa automática ao enviar, 0 respostas com pausa, reativar volta a responder)*

**Checkpoint**: Todas as stories funcionam.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T061 [P] Criar `src/routes/panel-static.ts`. Quando `web/dist/index.html` existir, registrar `@fastify/static` com `root` em `web/dist` e um `setNotFoundHandler` que entrega o `index.html` para `GET`s fora de `/api`, `/auth` e `/webhooks`, e responde 404 JSON para o resto. Registrar por último em `src/index.ts`. Conferir com `npm run build` e `npm start` que o painel abre em `:3000`.
- [X] T062 [P] Criar `scripts/seed-conversation.ts` (rodado com `node --env-file=.env --import tsx scripts/seed-conversation.ts [telefone] [quantidade=500]`), que insere uma conversa com N mensagens, alternando `customer` e `assistant`, com horários espaçados de 1 min e `wa_message_id` igual a `seed-<n>`.
- [X] T063 [P] Atualizar `README.md`:
  - na Stack, acrescentar React + Vite (painel);
  - na Estrutura, acrescentar `web/`, `src/modules/inbox/`, `src/modules/auth/` e `scripts/`;
  - nova seção "Painel web": `OPERATOR_PASSWORD`, `npm run dev` + `npm run dev:web` (em `http://localhost:5173`), produção com `npm run build && npm start` (em `:3000`), o fluxo de conexão por QR code, a pausa do assistente e o histórico, que começa quando a feature entra no ar;
  - na tabela de Endpoints, acrescentar `/api/*` com link para o contrato;
  - remover a frase sobre "a mesma mensagem entregue duas vezes" ficar só em memória.
- [ ] T064 Validar o [quickstart.md](quickstart.md) inteiro, de §0 a §6, numa sessão só: SC-001 a SC-007, incluindo o seed de 500 mensagens abrindo em até 2 s, a reinicialização do servidor com o painel aberto e o webhook duplicado. *(Pendente: precisa da Evolution API e do WhatsApp reais. Tudo o mais validado com a Evolution simulada em 2026-10-16; SC-006 medido: 500 mensagens abrem em 58 ms.)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 primeiro, porque pode mudar os contratos. T003 a T006 em paralelo depois de T002.
- **Foundational (Phase 2)**: depende da Phase 1.
  - Testes: T007 a T011 em paralelo.
  - Implementação: T012 → T015 → T016; T013 e T014 em paralelo; T017 → T018 → T019 → T020; T021 e T022 em paralelo; T023 fecha a fase.
- **US5 (Phase 3)**: depende da Phase 2.
- **US1 (Phase 4)**: depende da US5 (as rotas `/api` ficam atrás do hook de autenticação).
- **US2 (Phase 5)**: depende da US1 (usa `ConversationView` e `panel-api.ts`).
- **US3 (Phase 6)**: depende da US5. Pode rodar em paralelo com a US1 e a US2 até a T055, que mexe em `Inbox.tsx` e `App.tsx`.
- **US4 (Phase 7)**: depende da US2 (a pausa automática no envio) e da US1 (o cabeçalho da conversa).
- **Polish (Phase 8)**: T061 a T063 podem começar depois da US1; T064 depende de todas.

### User Story Dependencies

```text
Setup ─▶ Foundational ─▶ US5 ─┬─▶ US1 ─▶ US2 ─▶ US4 ─┐
                              └─▶ US3 ───────────────┴─▶ Polish
```

### Within Each User Story

- Testes primeiro, falhando.
- Servidor (service → rotas) antes do painel (componentes → página).
- `panel-api.ts` e `ConversationView.tsx` são editados por várias stories: as tarefas que mexem neles nunca são `[P]` entre si.

### Parallel Opportunities

- **Phase 1**: T003, T004, T005 e T006.
- **Phase 2**: os testes T007 a T011; T013 e T014; T021 e T022.
- **US5**: T024, T025 e T026; T027 e T028; T031 e T032.
- **US1**: T035 e T036; T039, T040 e T041.
- **US3**: T050 e T053 em paralelo entre si e com a US1 e a US2.
- **Polish**: T061, T062 e T063.

---

## Parallel Example: User Story 1

```text
# Testes da US1 juntos:
Task: "Testes das rotas de conversas em src/routes/panel-api.test.ts"
Task: "Testes do SSE em src/routes/panel-events.test.ts"

# Componentes independentes da US1 juntos:
Task: "useEvents em web/src/useEvents.ts"
Task: "ConversationList em web/src/components/ConversationList.tsx"
Task: "MessageBubble em web/src/components/MessageBubble.tsx"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup), Phase 2 (Foundational) e Phase 3 (US5, o login).
2. Phase 4 (US1, acompanhar as conversas).
3. **PARAR E VALIDAR**: [quickstart.md §2 e §4](quickstart.md). O operador já acompanha o atendimento do assistente em tempo real.

### Incremental Delivery

1. Setup + Foundational → todas as mensagens gravadas (útil mesmo sem painel).
2. + US5 → painel protegido.
3. + US1 → MVP: acompanhar.
4. + US2 → responder pelo painel.
5. + US3 → conectar o número pelo painel.
6. + US4 → assumir a conversa sem disputar com o assistente.
7. + Polish → build de produção, seed, README e validação completa.

---

## Notes

- `rag/` não muda nesta feature. O assistente continua igual; só o handler Node decide se pergunta ou não.
- A feature 001 continua coberta: os testes de `handle-message.test.ts` são adaptados, não removidos, e a deduplicação passa ao banco (T010, T011).
- Nunca registrar no log a senha do operador, o cookie de sessão ou o token do webhook.
- Desvios do plano na implementação: `@electric-sql/pglite` e `@electric-sql/pglite-socket` entraram como dependências de desenvolvimento (não há Postgres nem Docker nesta máquina), e a ordenação das mensagens desempata por `created_at`, porque o horário do WhatsApp vem em segundos. O índice da migration 0001 inclui essa coluna.
- Commit ao fim de cada fase. Convém criar a branch `002-whatsapp-web-inbox` antes da T001.
