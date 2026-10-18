# Implementation Plan: Painel web do WhatsApp

**Branch**: `002-whatsapp-web-inbox` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-whatsapp-web-inbox/spec.md`

## Summary

O plano tem quatro partes:

- **Registro**: o Secretaryfy passa a guardar no Postgres todas as mensagens individuais, em duas tabelas novas (`conversations` e `messages`). Isso vale para as recebidas, as do assistente, as do operador e as enviadas pelo celular. A chave única no ID da mensagem do WhatsApp evita duplicatas e substitui o dedupe em memória da feature 001.
- **API do painel**: o Fastify ganha a API em `/api/*`, protegida por uma senha única (`OPERATOR_PASSWORD`) e um cookie assinado com o `crypto.ts` que já existe.
- **Tempo real**: mensagens novas e mudanças de conexão chegam ao navegador por Server-Sent Events.
- **Painel**: uma SPA em React + Vite na pasta `web/`, com lista de conversas, histórico, envio, pausa do assistente, tela de conexão com QR code e login. Em desenvolvimento roda no Vite, com proxy para a API; em produção o Fastify entrega os arquivos.

O handler da feature 001 passa a gravar as mensagens e a respeitar a pausa por conversa. Decisões em [research.md](research.md).

## Technical Context

**Language/Version**: Node 24 + TypeScript 7 (servidor e painel)

**Primary Dependencies**:
- Já existentes: Fastify 5, Drizzle ORM com `postgres`, zod.
- Novas no servidor: `@fastify/cookie@11.1.2` e `@fastify/static@10.1.5`.
- Novas no painel: `react@19.3.0`, `react-dom@19.3.0`, `vite@8.3.1` e `@vitejs/plugin-react@6.1.1`, com os tipos `@types/react@19.3.0` e `@types/react-dom@19.3.0`.
- Todas com versão exata, publicada há mais de duas semanas.

**Storage**: Postgres, com as tabelas novas `conversations` e `messages`, os enums `message_origin`, `message_type` e `message_status`, e a migration `drizzle/0001_*.sql`. O estado da conexão e o limite de tentativas de login ficam em memória.

**Testing**:
- `node:test` para o servidor, sem banco: parser de eventos, regra de eco, handler com pausa, sessão, limite de login e SSE.
- Testes do repositório contra o Postgres quando `DATABASE_URL_TEST` estiver definida.
- O painel é coberto por `tsc` e pelo [quickstart.md](quickstart.md).

**Target Platform**: Desenvolvimento local no Windows 11, com navegadores atuais no computador.

**Project Type**: Web application: servidor Fastify já existente e SPA em `web/`, no mesmo repositório e no mesmo `package.json`.

**Performance Goals**:
- Mensagem nova aparece no painel em até 5 s (SC-001).
- Mensagem enviada chega ao cliente em até 5 s (SC-002).
- A lista e uma conversa com 500 mensagens abrem em até 2 s (SC-006).

**Constraints**:
- O webhook continua respondendo 200 na hora.
- Mensagem nenhuma aparece duplicada.
- Nenhuma rota do painel funciona sem login.
- Um único número conectado.
- O comportamento da feature 001 se mantém, a não ser pela pausa.

**Scale/Scope**: Um operador, um número e algumas dezenas de conversas por dia, num único processo Node.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `.specify/memory/constitution.md` continua sendo o template, sem princípios ratificados. Valem como gates as regras já praticadas no projeto, as mesmas da feature 001:

| Regra | Situação |
|---|---|
| Variáveis de ambiente validadas com zod em `src/config/env.ts` | ✅ `OPERATOR_PASSWORD` (opcional, mínimo de 12 caracteres) |
| Mudanças no banco por migration gerada pelo Drizzle | ✅ `npm run db:generate` → `drizzle/0001_*.sql` |
| Webhook responde antes de processar (feature 001, FR-013) | ✅ Mantido; o registro e o assistente rodam em segundo plano |
| O conteúdo e o comportamento do assistente em `rag/` não mudam | ✅ `rag/` não é alterado; só o handler Node decide se pergunta ou não |
| Segredos fora do código e do log | ✅ A senha e o cookie não vão para o log; o webhook continua protegido por token |
| Código e comentários de `src/` em português | ✅ |

**Pós-Fase 1**: sem violações. Continua valendo a recomendação de rodar `/speckit-constitution` para registrar essas regras.

## Project Structure

### Documentation (this feature)

```text
specs/002-whatsapp-web-inbox/
├── plan.md
├── research.md          # R1–R12
├── data-model.md        # tabelas, enums, transições e fluxos
├── quickstart.md        # roteiro §0–§6
├── contracts/
│   ├── panel-api.md     # /api/* e SSE
│   └── evolution.md     # eventos recebidos e chamadas à Evolution API
├── checklists/requirements.md
└── tasks.md             # gerado pelo /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── config/env.ts                    # + OPERATOR_PASSWORD (opcional), DATABASE_URL_TEST (opcional)
├── db/schema.ts                     # + conversations, messages, enums
├── index.ts                         # registra cookie, rotas do painel, SSE e arquivos estáticos
├── modules/
│   ├── auth/
│   │   ├── session.ts               # NOVO: senha, cookie assinado, hook de autenticação
│   │   ├── login-limiter.ts         # NOVO: 5 falhas por IP em 15 min
│   │   └── *.test.ts
│   ├── inbox/
│   │   ├── repository.ts            # NOVO: consultas Drizzle (conversas, mensagens, cursor, busca)
│   │   ├── service.ts               # NOVO: registrar recebida/eco, enviar (operador/assistente), pausar, ler
│   │   ├── events.ts                # NOVO: barramento de eventos para o SSE
│   │   ├── presenters.ts            # NOVO: linhas do banco → JSON do contrato; rótulos de mídia
│   │   └── *.test.ts
│   ├── rag/client.ts                # sem mudança
│   └── whatsapp/
│       ├── evolution.ts             # parser de eventos amplo (tipos de mídia, fromMe, connection/qrcode); sendWhatsAppText devolve key.id
│       ├── instance.ts              # NOVO: estado, QR code, webhook, logout, polling
│       ├── handle-message.ts        # passa a usar o inbox (gravar, checar a pausa antes e depois)
│       ├── dedupe.ts                # REMOVIDO (substituído pela chave única no banco)
│       └── *.test.ts
├── routes/
│   ├── evolution-webhook.ts         # despacha os 4 eventos
│   ├── panel-session.ts             # NOVO: /api/session
│   ├── panel-api.ts                 # NOVO: /api/connection, /api/conversations, /api/messages
│   ├── panel-events.ts              # NOVO: /api/events (SSE)
│   └── panel-static.ts              # NOVO: web/dist + fallback para o index.html
└── test/setup-env.ts                # + OPERATOR_PASSWORD de teste

web/
├── index.html
├── vite.config.ts                   # root web/, proxy /api → :3000, saída web/dist
├── tsconfig.json                    # lib DOM, jsx react-jsx
└── src/
    ├── main.tsx
    ├── App.tsx                      # sessão + rotas simples (login / painel / conexão)
    ├── api.ts                       # fetch tipado da API do painel
    ├── useEvents.ts                 # EventSource com reconexão e refetch
    ├── format.ts                    # telefone, horário, rótulos de origem e mídia
    ├── pages/
    │   ├── Login.tsx
    │   ├── Inbox.tsx                # lista + conversa aberta
    │   ├── Connection.tsx           # QR code, status, desconectar
    │   └── Disabled.tsx             # sem OPERATOR_PASSWORD
    ├── components/
    │   ├── ConnectionBadge.tsx      # status em todas as telas
    │   ├── ConversationList.tsx     # busca, não lidas, prévia
    │   ├── ConversationView.tsx     # histórico, rolagem infinita, pausar/reativar
    │   ├── MessageBubble.tsx        # origem, mídia, status, tentar de novo
    │   └── Composer.tsx             # texto, Enter/Shift+Enter, bloqueio sem conexão
    └── styles.css

scripts/seed-conversation.ts         # NOVO: popula 500 mensagens para o SC-006
package.json                         # + deps; scripts dev:web, build:web, build (tsc + vite build)
.env.example                         # + OPERATOR_PASSWORD
.gitignore                           # + web/dist/
README.md                            # + seção do painel
```

**Structure Decision**: A SPA fica em `web/` com seu próprio `tsconfig`, mas usa as dependências do `package.json` da raiz. O servidor continua em `src/`. Os dois se falam só pelo contrato [panel-api.md](contracts/panel-api.md). A lógica de mensagens fica em `src/modules/inbox/` e é usada tanto pelo webhook quanto pela API do painel. As rotas só traduzem HTTP.

## Implementation Notes

- **Ordem sugerida**: (1) schema + migration + repository/service do inbox + parser de eventos + webhook gravando, cobrindo os dados da US1 → (2) sessão, login e hook de autenticação (US5) → (3) API de conversas e SSE (US1) → (4) painel: login, lista e conversa (US1) → (5) envio e reenvio (US2) → (6) pausa no handler e na UI (US4) → (7) conexão e QR code (US3) → (8) script de seed, README e quickstart.
- **Handler da feature 001**: `createMessageHandler` deixa de receber `seen` e passa a receber `inbox`, com `isPaused(conversationId)` e `recordAssistantMessage(...)`. Nos testes, `handle-message.test.ts` troca o dedupe por um inbox falso. A deduplicação passa a ser testada no `service.test.ts`.
- **SSE no Fastify**: `reply.hijack()`, cabeçalhos `text/event-stream`, `cache-control: no-cache` e `x-accel-buffering: no`, e a assinatura do barramento é removida no `close` da requisição.
- **Polling da conexão**: só roda enquanto houver ao menos um assinante SSE. Começa no primeiro e para no último.
- **Formato do telefone**: `+55 11 99999-9999` quando começar com 55 e tiver 12 ou 13 dígitos; nos outros casos, `+` seguido dos dígitos.
- **Prévia**: o texto ou o rótulo da mídia, cortado em 120 caracteres.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Toolchain de front-end (React + Vite) no repositório do servidor | A interface de chat em tempo real, com rolagem infinita, estado de envio e conexão, pedida na spec | HTML do servidor + htmx deixaria o tempo real e o estado das mensagens mais difíceis de manter ([research.md R1](research.md#r1-front-end)) |
