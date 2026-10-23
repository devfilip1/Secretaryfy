# Implementation Plan: Proteção do número contra banimento (anti-ban)

**Branch**: `004-whatsapp-anti-ban` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-whatsapp-anti-ban/spec.md`

## Summary

O plano tem cinco partes:

- **Portão único de envio**: um módulo novo, `src/modules/antiban/`, por onde passa todo envio ao WhatsApp, do assistente e do operador. Antes de entrar na fila, ele verifica as regras e recusa ou avisa: janela de 24 h, pedido de saída, insistência, laço, texto repetido, conversas por dia e freio. A recusa vira uma mensagem `blocked`, com o motivo, no histórico.
- **Ritmo humano**: um temporizador de silêncio junta as mensagens seguidas do cliente. Antes de responder, o sistema marca as mensagens como lidas e manda o texto com o `delay` da Evolution, que mostra "digitando…" por um tempo proporcional e aleatório. Uma fila em memória espaça os envios dentro dos limites por minuto e por hora, contados no banco.
- **Pedido de saída**: reconhecido por lista fixa antes do roteador, guardado por telefone em `contact_preferences`. Assim ele sobrevive à limpeza das conversas ao desconectar.
- **Aquecimento e freio**: `connected_numbers` define a rampa de limites dos primeiros 14 dias. `protection_state` guarda o freio, que dispara por falhas de envio ou quedas de conexão e pausa os envios automáticos por 30 min.
- **Painel**:
  - uma faixa com o estado da proteção;
  - um diálogo de risco antes de o operador enviar para contato frio, cliente que saiu ou com o freio ativo;
  - o motivo das mensagens não enviadas e a reativação de quem saiu.

Decisões em [research.md](research.md).

## Technical Context

**Language/Version**: Node 24 + TypeScript 7 (servidor e painel). O `rag/` não muda.

**Primary Dependencies**: Fastify 5, Drizzle ORM com `postgres`, zod e React 19 + Vite 8, todos já existentes. **Nenhuma dependência nova**: a fila, o temporizador e o disjuntor são escritos à mão (algumas dezenas de linhas cada) e testados com relógio falso.

**Storage**: Postgres, migration `drizzle/0004_antiban.sql`:
- `message_status` ganha o valor `blocked`, e `messages` ganha um índice parcial para as contagens de envio.
- Tabelas novas: `contact_preferences`, `connected_numbers` e `protection_state`.

Ver [data-model.md](data-model.md).

**Testing**: `node:test`, sem rede.
- **Funções puras:** `typingDelay`, `stripLinks`, `matchOptOut`, `assessConversation` e `warmupLimits`.
- **Fila e temporizador:** com `setTimeout` e `now` injetados.
- **Portão:** com o repositório no Postgres de teste (`DATABASE_URL_TEST`).
- **Rotas:** `/api/protection`, `confirmRisk`, `retry_too_soon`, `too_many_attempts` e `PATCH optedOut`.
- **Ponta a ponta:** pelo [quickstart.md](quickstart.md).

**Target Platform**: Desenvolvimento local no Windows 11, com Evolution API v2.3.7 no Docker.

**Project Type**: Web application já existente: servidor Fastify em `src/` e SPA em `web/`.

**Performance Goals**:
- Uso normal, com um cliente por vez: a resposta atrasa até 4 s de silêncio mais 2 a 12 s de digitação, dentro dos 15 s extras do SC-007 na maioria das mensagens.
- 20 clientes simultâneos: nenhum minuto passa do limite e nada se perde dentro de 5 min de fila (SC-002).

**Constraints**:
- Um processo Node só: a fila e os temporizadores ficam em memória.
- O webhook continua respondendo 200 na hora.
- A pausa da feature 002 é verificada de novo na saída da fila.
- Nenhum texto de mensagem nos logs da proteção.
- O operador nunca é bloqueado sem aviso; o assistente é.

**Scale/Scope**: Uma clínica, um número e algumas dezenas de conversas por dia.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `.specify/memory/constitution.md` continua sendo o template. Valem como gates as regras já praticadas nas features 001 a 003:

| Regra | Situação |
|---|---|
| Variáveis de ambiente validadas com zod em `src/config/env.ts` | ✅ `ANTIBAN_*`, todas com padrão e com validação mínimo ≤ máximo |
| Mudanças no banco por migration gerada pelo Drizzle | ✅ `drizzle/0004_antiban.sql`. O valor novo do enum não é usado na própria migration |
| Webhook responde antes de processar | ✅ O temporizador e a fila rodam depois da resposta 200 |
| O comportamento do assistente em `rag/` não muda | ✅ `rag/` não é alterado; só a mensagem fixa de indisponibilidade ganha variações, no Node |
| Segredos e dados pessoais fora do log | ✅ A proteção registra o motivo e o id da conversa, nunca o texto |
| Código e comentários de `src/` em português | ✅ Textos ao cliente em inglês, como na 001 e na 003 |
| Dependências com versão exata e publicadas há mais de 2 semanas | ✅ Nenhuma dependência nova |

**Pós-Fase 1**: sem violações. A recomendação de rodar `/speckit-constitution` para registrar essas regras continua de pé.

## Project Structure

### Documentation (this feature)

```text
specs/004-whatsapp-anti-ban/
├── plan.md
├── research.md            # R1–R15
├── data-model.md          # tabelas, motivos de bloqueio, ciclo de vida, configuração
├── quickstart.md          # roteiro §1–§9, sem segundo número
├── contracts/
│   ├── panel-api.md       # /api/protection, confirmRisk, 409/429, optedOut, SSE protection.updated
│   ├── evolution.md       # sendText com delay, markMessageAsRead, uso de connection.update
│   └── conversation.md    # palavras de saída/volta, textos com variações, registros system
├── checklists/requirements.md
└── tasks.md               # gerado pelo /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── config/env.ts                       # + ANTIBAN_* (data-model.md#configuração)
├── db/schema.ts                        # + status blocked, índice de envios, contact_preferences,
│                                       #   connected_numbers, protection_state
├── index.ts                            # monta o portão, limpa "sending" órfãos ao subir, rota /api/protection
├── modules/
│   ├── antiban/                        # NOVO
│   │   ├── limits.ts                   # lê o env e aplica a rampa de aquecimento (warmupLimits)
│   │   ├── typing.ts                   # typingDelay, intervalo aleatório entre envios
│   │   ├── links.ts                    # stripLinks (primeira resposta, allowlist)
│   │   ├── opt-out.ts                  # normalização, matchOptOut / matchOptIn
│   │   ├── assess.ts                   # assessConversation: unanswered, loop (função pura)
│   │   ├── repository.ts               # contagens de envio, preferências, connected_numbers, protection_state
│   │   ├── breaker.ts                  # freio: falhas, quedas, pausa e retomada, evento SSE
│   │   ├── queue.ts                    # fila FIFO com um trabalhador, expiração, esvaziar no freio
│   │   ├── debounce.ts                 # temporizador de silêncio por conversa
│   │   ├── gate.ts                     # o portão: regras → blocked | aviso | fila; único chamador de send
│   │   └── *.test.ts
│   ├── inbox/
│   │   ├── service.ts                  # deliver() passa pelo portão; recordBlocked(); optedOut na conversa
│   │   ├── repository.ts               # recentTexts ignora blocked; mensagens do cliente desde a última resposta
│   │   ├── presenters.ts               # + optedOut, status blocked
│   │   └── events.ts                   # + protection.updated
│   ├── scheduling/replies.ts           # variações de indisponível; textos de saída/volta; registros system novos
│   └── whatsapp/
│       ├── evolution.ts                # sendText com delay/linkPreview; markMessagesRead()
│       ├── handle-message.ts           # saída/volta antes do roteador; resposta vai ao portão, não ao send
│       └── instance.ts                 # quedas e pedidos de QR com janela; TooManyAttempts; connected_numbers
├── routes/
│   ├── evolution-webhook.ts            # mensagem do cliente → debounce; connection.update → freio/aquecimento
│   ├── panel-api.ts                    # confirmRisk, 409/429, PATCH optedOut, 429 no QR
│   └── panel-protection.ts             # NOVO: GET /api/protection
└── test/setup-env.ts                   # sem mudança (todas as ANTIBAN_* têm padrão)

web/src/
├── api.ts                              # + getProtection, confirmRisk, optedOut, status blocked
├── useEvents.ts                        # + protection.updated
├── App.tsx                             # faixa de estado da proteção
├── components/
│   ├── Composer.tsx                    # diálogo de risco no 409 e reenvio com confirmRisk
│   ├── MessageBubble.tsx               # "Não enviada pela proteção: <motivo>", sem reenviar
│   ├── ConversationView.tsx            # aviso "não quer receber mensagens" + botão reativar
│   └── ProtectionBanner.tsx            # NOVO: normal / aquecimento / freio
└── styles.css
```

**Structure Decision**: Mantém a aplicação web existente. A proteção vira um módulo próprio, `src/modules/antiban/`, porque atravessa o assistente, o operador e a conexão. Os módulos existentes só trocam a chamada direta de envio pelo portão e ganham os campos novos.

## Complexity Tracking

Sem violações a justificar.
