# Implementation Plan: Nome do cliente, cadastro de clientes e serviço no agendamento

**Branch**: `005-customer-name-registry` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-customer-name-registry/spec.md`

## Summary

O plano tem quatro partes, todas no servidor Node (`src/`):

- **Nome dito separado do nome do perfil**: hoje o agendamento usa o `pushName` do WhatsApp (`conversations.name`), que é sobrescrito a cada mensagem e muitas vezes não é um nome. A conversa ganha `customer_name` (o nome que o cliente disse) e `name_asked_at`. O nome conhecido de um número passa a ser `customer_name` → cadastro de clientes; o perfil não conta.
- **Pedido e leitura do nome**: o roteador anexa um texto fixo ("By the way, may I have your name?") como última mensagem da primeira resposta do folheto a um número sem nome conhecido, uma vez por conversa. O interpretador lê o nome por regras ("my name is…", "I'm…", ou a mensagem inteira logo depois do pedido) e, quando precisa, pelo llama3, que agora pode devolver o nome junto de outra intenção.
- **Serviço no agendamento**: um catálogo fixo com os 8 tratamentos do folheto e "Assessment". O serviço vem do tratamento citado por último na conversa; sem ele, uma nova etapa `choose_service` oferece a lista numerada. O resumo mostra o serviço e aceita trocá-lo, e o evento passa a se chamar `"<nome> — <serviço>"`.
- **Cadastro de clientes**: tabela `customers` (id, telefone único, nome), sem ligação com as conversas para sobreviver à limpeza. É gravada por upsert depois de o evento e o agendamento existirem; `appointments` guarda o serviço e o cliente.

O RAG em Python não muda. Decisões em [research.md](research.md).

## Technical Context

**Language/Version**: Node 24 + TypeScript 7 (servidor e painel). O `rag/` em Python não muda.

**Primary Dependencies**: as já existentes (Fastify 5, Drizzle ORM com `postgres`, zod, `googleapis`, luxon, React 19 + Vite 8; Ollama com `llama3` para o interpretador). Nenhuma dependência nova.

**Storage**: Postgres, migration `drizzle/0005_customers.sql` gerada pelo Drizzle:
- Nova tabela `customers`.
- `conversations` ganha `customer_name` e `name_asked_at`.
- `scheduling_sessions` ganha `service`; o enum `scheduling_step` ganha `choose_service`.
- `appointments` ganha `service` e `customer_id`.

Ver [data-model.md](data-model.md).

**Testing**:
- `node:test` sem rede, no padrão atual: interpretador com Ollama falso (regras de nome, lista de não-nomes, `choose_service`, `name` junto de `question`), catálogo e detecção de serviço, fluxo com agenda falsa (`src/test/fake-calendar.ts`: etapa `choose_service`, troca no resumo, título e descrição do evento, upsert do cadastro e nada gravado em falha), roteador (pedido de nome uma vez, `followUp`, nome do cadastro), envio em até 3 mensagens com `followUp`, repositórios no PGlite e `DELETE /api/conversations` preservando `customers`.
- Um teste confere o catálogo contra os títulos das seções em `rag/data/index/section/chunks.json`, para o catálogo não ficar para trás se o folheto mudar.
- `scripts/eval-scheduling.ts` ganha cenários com serviço citado e não citado (SC-004).
- Ponta a ponta pelo [quickstart.md](quickstart.md).

**Target Platform**: Desenvolvimento local no Windows 11; Evolution API, Google Calendar API v3 e Ollama locais/externos como hoje.

**Project Type**: Web application já existente: servidor Fastify em `src/` e SPA em `web/`.

**Performance Goals**:
- Nenhuma chamada nova ao modelo no caminho comum: nome e serviço são lidos por regras; o modelo só entra nos casos que já iam para ele.
- Marcar não fica mais longo para quem já disse o nome: no máximo uma pergunta a mais (o serviço), e nenhuma quando o tratamento já foi citado (SC-007).

**Constraints**:
- No máximo 3 mensagens seguidas por resposta, contando o pedido de nome (`ANTIBAN_MAX_UNANSWERED=3`, feature 004).
- O pedido de nome não bloqueia a resposta à dúvida (FR-002) e não se repete (FR-005).
- O cadastro só recebe quem teve o evento criado e o agendamento gravado (FR-018).
- Apagar conversas e desconectar o número não apagam `customers` (FR-019).
- Textos ao cliente em inglês; registros e telas do painel em português.

**Scale/Scope**: Uma clínica, um processo Node, algumas dezenas de conversas e agendamentos por dia.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `.specify/memory/constitution.md` continua sendo o template. Valem como gates as regras já praticadas nas features 001 a 004:

| Regra | Situação |
|---|---|
| Mudanças no banco por migration gerada pelo Drizzle | ✅ `drizzle/0005_customers.sql` |
| Webhook responde antes de processar | ✅ Nada muda no webhook; tudo acontece no roteador, já em segundo plano |
| Todo envio passa pela proteção do número (004) | ✅ O pedido de nome sai pelo mesmo `gate.sendAssistant`, contado no limite de 3 mensagens |
| O modelo só interpreta; textos e decisões do agendamento são do código (003) | ✅ Pedido de nome, lista de serviços, resumo e título do evento são textos fixos; o serviço vem de um catálogo |
| O Google Agenda é a fonte da verdade (003) | ✅ O cadastro só é gravado depois do evento criado; remarcar continua movendo o mesmo evento |
| Código e comentários de `src/` em português; textos ao cliente em inglês | ✅ |
| Dependências com versão exata e publicadas há mais de 2 semanas | ✅ Nenhuma dependência nova |

**Pós-Fase 1**: sem violações. Continua valendo a recomendação de rodar `/speckit-constitution` para registrar essas regras.

## Project Structure

### Documentation (this feature)

```text
specs/005-customer-name-registry/
├── plan.md              # Este arquivo
├── research.md          # Fase 0: decisões R1 a R8
├── data-model.md        # Fase 1: customers, colunas novas, catálogo, transições
├── quickstart.md        # Fase 1: roteiro de validação
├── contracts/
│   ├── conversation.md      # Textos ao cliente: pedido de nome, lista de serviços, resumo
│   ├── interpreter.md       # awaitingName, choose_service, nome junto de outra intenção
│   ├── google-calendar.md   # Título e descrição do evento
│   └── panel-api.md         # ConversationJson.name e a busca
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
drizzle/
└── 0005_customers.sql                 # novo (gerado)

src/
├── db/schema.ts                        # customers; colunas em conversations, scheduling_sessions, appointments; choose_service
├── modules/
│   ├── customers/
│   │   └── repository.ts               # novo: findByPhone, upsert
│   ├── inbox/
│   │   ├── repository.ts               # setCustomerName, markNameAsked, customerMessagesSince; busca por customer_name
│   │   ├── service.ts                  # nome conhecido; publica conversation.updated ao gravar o nome
│   │   └── presenters.ts               # name = customer_name ?? name
│   ├── scheduling/
│   │   ├── services.ts                 # novo: catálogo e detectService(texts)
│   │   ├── interpret.ts                # awaitingName, regras de nome, lista de não-nomes, choose_service
│   │   ├── router.ts                   # nome conhecido, pedido de nome (followUp), give_name fora do fluxo, mentionedService
│   │   ├── flow.ts                     # choose_service, troca no resumo, título/descrição do evento, upsert do cliente
│   │   ├── sessions.ts                 # service na sessão; insertBooked com service e customer_id
│   │   └── replies.ts                  # askNameFollowUp, nameReceived, chooseService, resumo com serviço
│   └── whatsapp/handle-message.ts      # Reply.followUp; splitReply com limite de partes
└── routes/evolution-webhook.ts         # injeta o repositório de clientes no roteador e no fluxo

scripts/
├── eval-scheduling.ts                  # cenários de serviço citado / não citado
└── fixtures/scheduling-scenarios.json
```

Testes ao lado de cada módulo (`*.test.ts`), como no resto do projeto. O painel (`web/`) não muda: o nome já vem pronto no campo `name`.

**Structure Decision**: segue a estrutura existente (servidor em `src/modules/*` com um módulo por domínio). O cadastro de clientes vira um módulo próprio, `src/modules/customers/`, porque não pertence às conversas (sobrevive à limpeza) nem ao agendamento (é lido também pelo roteador para o nome conhecido).

## Complexity Tracking

Sem violações a justificar.
