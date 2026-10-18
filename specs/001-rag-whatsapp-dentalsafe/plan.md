# Implementation Plan: Respostas da DentalSafe pelo WhatsApp com o RAG do RagLab

**Branch**: `001-rag-whatsapp-dentalsafe` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-rag-whatsapp-dentalsafe/spec.md`

## Summary

O assistente da DentalSafe e a bancada de avaliação do RagLab são copiados, sem alterações, para `rag/` no repositório do Secretaryfy. Por cima deles entra um servidor FastAPI fino (`rag/server.py`) com `/health`, `/answer` e `/retrieve`, que chama diretamente o `retrieve()` e o `answer()` do pipeline. No Node, o webhook da Evolution API responde 200 na hora e, em segundo plano, pergunta ao serviço RAG e devolve a resposta pelo WhatsApp. Em falha ou timeout, envia uma mensagem de indisponibilidade. A cópia é validada com a própria bancada do RagLab contra a referência gravada (`20261011-191541`). Decisões em [research.md](research.md).

## Technical Context

**Language/Version**: Python 3.14 (`rag/`); Node 24 + TypeScript 7 (Secretaryfy)

**Primary Dependencies**: as do RagLab, sem mudança (LangChain, langchain-chroma, langchain-ollama, rank-bm25, pypdf), mais `fastapi` (0.142.x), `uvicorn==0.54.0` e `httpx==0.28.1`. No Node, nenhuma dependência nova: `fetch` e `AbortSignal.timeout` são nativos e os testes usam `node:test` com o `tsx` que já existe.

**Storage**: Índices Chroma e `chunks.json` em `rag/data/index/` (gerados, fora do git). Nada novo no Postgres. A deduplicação de mensagens fica em memória.

**Testing**: `pytest` em `rag/` (testes do RagLab + `tests/unit/test_server.py`, sem Ollama); a bancada do RagLab (`evaluation validate | kb-check | experiments | run --no-judge`); `node --import tsx --test` no Secretaryfy; ponta a ponta manual pelo [quickstart.md](quickstart.md).

**Target Platform**: Máquina de desenvolvimento Windows 11, com tudo local (Ollama, serviço RAG em loopback, Node, Postgres no Docker, Evolution API).

**Project Type**: Web service (Node) + serviço local auxiliar (Python), no mesmo repositório.

**Performance Goals**: Resposta no WhatsApp em até 10 s em 9 de cada 10 perguntas (SC-003). A resposta típica do assistente é de 0,7 s com o modelo carregado.

**Constraints**: O webhook responde antes de consultar o assistente. O timeout padrão de 30 s cobre o carregamento do llama3. O conteúdo da DentalSafe (folheto, prompt, sinônimos, gabarito) não pode mudar. Nenhum gasto de API.

**Scale/Scope**: Um desenvolvedor testando, com poucas mensagens por minuto, um único folheto e sem multi-tenant.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A `.specify/memory/constitution.md` ainda é o template, sem princípios ratificados. Não há gate formal. Por isso apliquei como gates as regras já em vigor nos dois projetos:

| Regra (origem) | Situação |
|---|---|
| Mudança que pode afetar respostas é medida com `evaluation run --no-judge` contra a referência (RagLab CLAUDE.md) | ✅ O pipeline não muda; a cópia é medida mesmo assim (quickstart §1, SC-001). |
| `assistant` nunca importa `evaluation` (RagLab CLAUDE.md) | ✅ `server.py` fica na raiz de `rag/` e importa só `assistant`. |
| `NO_ANSWER` e `ABSTENTION_PATTERNS` andam juntos (RagLab CLAUDE.md) | ✅ Nenhum dos dois muda. |
| Testes unitários não dependem do Ollama (RagLab pytest.ini) | ✅ `test_server.py` usa monkeypatch. |
| `Makefile` e `run.ps1` com os mesmos atalhos (RagLab test_shortcuts.py) | ✅ `serve` entra nos dois. |
| Código em `rag/` em inglês; Secretaryfy em português (convenções atuais) | ✅ Seguido. |
| Variáveis de ambiente validadas com zod em `src/config/env.ts` (Secretaryfy) | ✅ `RAG_SERVICE_URL`, `RAG_TIMEOUT_MS`. |

**Pós-Fase 1**: o design não introduziu violações. Recomendo rodar `/speckit-constitution` antes da próxima feature, para registrar essas regras.

## Project Structure

### Documentation (this feature)

```text
specs/001-rag-whatsapp-dentalsafe/
├── plan.md              # este arquivo
├── research.md          # decisões R1–R10
├── data-model.md        # entidades e fluxo da mensagem
├── quickstart.md        # roteiro de validação
├── contracts/
│   └── rag-service.md   # /health, /answer, /retrieve e inicialização
├── checklists/
│   └── requirements.md
└── tasks.md             # gerado por /speckit-tasks
```

### Source Code (repository root)

```text
rag/                                   # cópia do RagLab (R1)
├── assistant/                         # sem mudanças
├── evaluation/                        # sem mudanças no código
│   ├── data/                          # gabarito DentalSafe
│   ├── schemas/
│   └── runs/
│       ├── baseline.json
│       ├── 20261011-191541/
│       ├── 20261011-132527-reference-holdout/
│       └── experiments/.gitkeep
├── config/                            # strategies.yaml, experiments.yaml, schemas
├── data/source/DentalSafe.pdf
├── tests/
│   ├── unit/test_server.py            # NOVO
│   └── ...                            # testes do RagLab
├── server.py                          # NOVO: FastAPI + checagem de índice + uvicorn
├── requirements.txt                   # + fastapi, uvicorn, httpx
├── Makefile, run.ps1                  # + atalho "serve"
├── pytest.ini, .env.example, .gitattributes
└── README.md                          # NOVO: origem e comandos

src/
├── config/env.ts                      # + RAG_SERVICE_URL, RAG_TIMEOUT_MS
├── modules/
│   ├── rag/
│   │   ├── client.ts                  # NOVO: askRag(), RagUnavailableError
│   │   └── client.test.ts             # NOVO
│   └── whatsapp/
│       ├── evolution.ts               # + id na IncomingMessage, ignora texto vazio
│       ├── evolution.test.ts          # NOVO
│       ├── dedupe.ts                  # NOVO: markSeen()
│       ├── dedupe.test.ts             # NOVO
│       ├── handle-message.ts          # NOVO: dedupe → askRag → sendWhatsAppText / indisponível
│       └── handle-message.test.ts     # NOVO
├── test/setup-env.ts                  # NOVO: env falso para os testes que importam env.ts
└── routes/evolution-webhook.ts        # dispara handleIncomingMessage sem await

.env.example                           # + RAG_SERVICE_URL, RAG_TIMEOUT_MS
.gitignore                             # + rag/.venv/, rag/.env, rag/data/index/, rag/evaluation/runs/_incomplete/, __pycache__/, .pytest_cache/
package.json                           # + script "test"
README.md                              # + seção do serviço RAG (FR-020)
```

**Structure Decision**: O repositório passa a ter um projeto Node na raiz (como hoje) e um projeto Python autocontido em `rag/`, com seu próprio venv, requirements e testes. Os dois se falam só por HTTP local, pelo contrato em [contracts/rag-service.md](contracts/rag-service.md). O `handle-message.ts` recebe suas dependências (`ask`, `send`, `log`) como parâmetros, para ser testado sem rede.

## Implementation Notes

- **Ordem sugerida**: (1) cópia + `.gitignore` + rodar a bancada (US2, que valida tudo antes de qualquer código novo) → (2) `server.py` + testes + atalho (US4 e contrato) → (3) env + cliente RAG + dedupe + handler + webhook (US1 e US3) → (4) READMEs.
- **Mensagem de indisponibilidade**: constante em `handle-message.ts`, com o texto "Sorry, our virtual assistant is unavailable right now. Please try again in a few minutes."
- **Log**: o handler registra `info` com `{ phone, latency_s }` em sucesso e `error` com `{ phone, err }` em falha. O texto da mensagem do cliente não vai para o log, só o telefone, como o webhook já faz hoje.
- **Erros em `/answer` e `/retrieve`**: `try/except Exception` em volta da chamada ao pipeline → `logger.exception` + `HTTPException(503, detail=str(error))`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Segundo runtime (Python) no repositório | Reaproveitar o RagLab sem reescrever, e com a bancada de avaliação funcionando (objetivo da spec) | Portar para TypeScript perderia a bancada e a referência medida, e vai ser reavaliado quando chegar a hora de produção |
