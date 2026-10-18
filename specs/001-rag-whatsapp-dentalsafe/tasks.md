---

description: "Task list for 001-rag-whatsapp-dentalsafe"
---

# Tasks: Respostas da DentalSafe pelo WhatsApp com o RAG do RagLab

**Input**: Design documents from `/specs/001-rag-whatsapp-dentalsafe/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/rag-service.md](contracts/rag-service.md), [quickstart.md](quickstart.md)

**Tests**: Incluídos. O plano ([research.md R10](research.md#r10-testes)) define testes unitários em Python para o serviço e testes `node:test` para o Node. Nenhum teste unitário depende do Ollama.

**Organization**: Tasks agrupadas por user story. A US2 vem logo depois da fundação porque valida a cópia antes de qualquer código novo, como manda a ordem sugerida no plano. Todas as stories dependem da fase Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1–US4, conforme a [spec](spec.md)
- Origem do RagLab: `C:\Users\Filipi\Desktop\Projects\RagLab` (somente leitura; nunca alterar)

## Path Conventions

- Projeto Node na raiz: `src/`, `package.json`, `.env.example`
- Projeto Python autocontido em `rag/`, com venv próprio em `rag/.venv/`. Os comandos Python rodam de dentro de `rag/` com `.venv/Scripts/python.exe` (Windows)
- Código em `rag/` em inglês; código e comentários em `src/` em português

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Trazer o RagLab para `rag/` e preparar o ambiente Python.

- [X] T001 Copiar do RagLab para `rag/`, preservando a estrutura de pastas: `assistant/`, `config/` (com `schemas/`), `tests/` (`unit/`, `integration/`, `fixtures/`, sem `__pycache__/`), `data/source/DentalSafe.pdf`, `requirements.txt`, `pytest.ini`, `.env.example`, `Makefile`, `run.ps1` (manter o BOM UTF-8, que o `test_shortcuts.py` exige) e `.gitattributes`. De `evaluation/`, copiar todos os `.py`, `README.md`, `data/` e `schemas/`. Não copiar `.venv/`, `data/index/`, `.pytest_cache/`, `__pycache__/`, `.specify/`, `specs/`, `.claude/`, `.vscode/`, `CLAUDE.md`, `docs/` nem `README.md` da raiz.
- [X] T002 Copiar para `rag/evaluation/runs/` apenas `baseline.json`, `.gitkeep`, `experiments/.gitkeep` e as pastas `20261011-191541/` e `20261011-132527-reference-holdout/` (as que o `baseline.json` referencia).
- [X] T003 Conferir que a cópia é fiel. Comparar os hashes (por exemplo, `Get-FileHash`) de todos os arquivos copiados em T001–T002 com os do RagLab. Todos precisam bater, principalmente `assistant/pipeline.py`, `assistant/config.py`, `config/*.yaml`, `evaluation/data/answer_key.json` e o PDF (FR-004).
- [X] T004 [P] Acrescentar ao `.gitignore` da raiz: `rag/.venv/`, `rag/.env`, `rag/data/index/`, `rag/evaluation/runs/_incomplete/`, `__pycache__/` e `.pytest_cache/` (FR-005).
- [X] T005 Acrescentar a `rag/requirements.txt`, no mesmo formato fixado com `==`: `fastapi` (a versão 0.142.x mais recente; ver [research.md R2](research.md#r2-framework-do-serviço-http)), `uvicorn==0.54.0` e `httpx==0.28.1`. Depois criar o venv e instalar: `python -m venv rag/.venv` e `rag/.venv/Scripts/python.exe -m pip install -r rag/requirements.txt`.
- [X] T006 Construir os índices: de dentro de `rag/`, rodar `.venv/Scripts/python.exe -m assistant.ingest`. Conferir que a estratégia `section` gera 11 chunks.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: O serviço RAG respondendo `/answer` e `/retrieve`, e a configuração do Node. Sem isso, nenhuma story funciona.

**⚠️ CRITICAL**: Nenhuma story começa antes desta fase.

- [X] T007 Criar `rag/server.py` com `create_app(config: RagConfig) -> FastAPI` e `main()`.
  - Importar `answer` e `retrieve` de `assistant.pipeline` como nomes do módulo, para os testes poderem fazer monkeypatch.
  - Modelo de entrada `QuestionIn` com `question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]`.
  - `POST /answer`, endpoint `def`: chama `answer(question, config)` e devolve `{answer, chunks, latency_s, experiment}`. `chunks` vem de `result.retrieval.fused`, cada item com `{rank, content, score, similarity}`.
  - `POST /retrieve`, endpoint `def`: mede o tempo com `time.perf_counter()` em volta de `retrieve(question, config)` e devolve `{chunks, latency_s, experiment}`.
  - Os dois endpoints envolvem a chamada ao pipeline em `try/except Exception`, registram com `logging.getLogger("rag.server").exception(...)` e respondem `HTTPException(503, detail=str(error))`.
  - `main()` lê `RAG_HOST` (padrão `127.0.0.1`) e `RAG_PORT` (padrão `8001`) com `os.getenv`, depois de importar `assistant.config`, que já carrega o `rag/.env`. Em seguida chama `uvicorn.run(create_app(RagConfig()), host=..., port=...)`. Rodar com `python -m server`. Formatos em [contracts/rag-service.md](contracts/rag-service.md).
- [X] T008 [P] Adicionar o atalho `serve` (`-m server`, "Start the assistant HTTP service") em `rag/run.ps1` e em `rag/Makefile` (`serve: ## Start the assistant HTTP service` → `$(PYTHON) -m server $(ARGS)`, e incluir `serve` no `.PHONY`), mantendo os dois idênticos em nome e descrição.
- [X] T009 [P] Escrever `rag/tests/unit/test_server.py` com `fastapi.testclient.TestClient(create_app(RagConfig.from_experiment("section_hybrid")))` e monkeypatch de `server.answer`/`server.retrieve` retornando `AnswerResult`/`RetrievalResult` falsos. Casos:
  - `/answer` devolve `answer`, `chunks` com rank e similaridade, `latency_s` e `experiment`;
  - `/retrieve` não traz `answer`;
  - pergunta `"   "` e corpo sem `question` → 422, sem chamar o pipeline (o fake registra se foi chamado);
  - o pipeline levantando `ConnectionError` → 503 com `detail`.
- [X] T010 [P] Em `src/config/env.ts`, acrescentar ao schema `RAG_SERVICE_URL: z.url().default("http://127.0.0.1:8001")` e `RAG_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)`. Em `.env.example`, acrescentar uma seção `# Serviço RAG (rag/, ver README)` com as duas variáveis e esses valores (FR-019).
- [X] T011 [P] Criar `src/test/setup-env.ts`, que preenche `process.env` com valores falsos válidos para todas as variáveis obrigatórias de `src/config/env.ts` (sem sobrescrever o que já existir), para os módulos que importam `env` poderem ser testados. Em `package.json`, adicionar o script `"test": "node --import tsx --import ./src/test/setup-env.ts --test \"src/**/*.test.ts\""`. Em `tsconfig.json`, adicionar `"exclude": ["src/**/*.test.ts", "src/test"]` para os testes não irem para `dist/`.
- [X] T012 Rodar `.venv/Scripts/python.exe -m pytest` em `rag/`: todos os testes passam, incluindo `test_server.py` e `test_shortcuts.py`. Rodar `npm run typecheck` na raiz sem erros.

**Checkpoint**: `python -m server` sobe e `POST /answer` responde. A partir daqui as stories podem avançar.

---

## Phase 3: User Story 2 - A qualidade continua a mesma depois da cópia (Priority: P1)

**Goal**: Provar, com a bancada do RagLab, que a cópia em `rag/` se comporta como a referência.

**Independent Test**: [quickstart.md §1](quickstart.md#1-o-assistente-copiado-mantém-a-qualidade-us2), sem precisar do Node nem do WhatsApp.

- [X] T013 [US2] De dentro de `rag/`, rodar `.venv/Scripts/python.exe -m evaluation validate` e depois `-m evaluation kb-check`. Os dois passam sem erros (0 duplicados, 0 fatos sem âncora, 0 chunks corrompidos).
- [X] T014 [US2] Rodar `.venv/Scripts/python.exe -m evaluation experiments` e confirmar `section_hybrid` com 44/44 (SC-002). Requer o Ollama no ar.
- [X] T015 [US2] Rodar `.venv/Scripts/python.exe -m evaluation run --no-judge` e confirmar entre 47 e 51 acertos de 51, com a comparação contra a referência `20261011-191541` aparecendo no relatório (SC-001). Se ficar fora da faixa, rodar com `--repeat 3` antes de investigar. Não definir nova referência (`baseline set`).
- [X] T016 [US2] Rodar `.venv/Scripts/python.exe -m pytest -m integration` em `rag/` e confirmar que passa.

**Checkpoint**: Cópia validada com números. Os resultados de T014–T015 vão para o relatório final da implementação.

---

## Phase 4: User Story 1 - Cliente tira dúvida pelo WhatsApp (Priority: P1) 🎯 MVP

**Goal**: Uma mensagem de texto no WhatsApp recebe a resposta do assistente na mesma conversa.

**Independent Test**: [quickstart.md §3 e §4](quickstart.md#4-atendimento-pelo-whatsapp-us1), com o serviço RAG e o Secretaryfy no ar.

### Tests for User Story 1

- [X] T017 [P] [US1] Escrever `src/modules/whatsapp/evolution.test.ts` para `parseIncomingMessage`:
  - evento válido devolve `id` (de `data.key.id`), `phone` e `text`;
  - devolve `null` em: texto só com espaços, sem `key.id`, `fromMe: true`, JID de grupo (`@g.us`), mensagem sem texto (por exemplo, só `imageMessage`) e evento diferente de `messages.upsert`.
- [X] T018 [P] [US1] Escrever `src/modules/whatsapp/dedupe.test.ts`:
  - `markSeen` devolve `true` na primeira vez e `false` na repetição;
  - devolve `true` de novo depois da validade (injetar `now`);
  - com capacidade 3, o quarto ID descarta o mais antigo.
- [X] T019 [P] [US1] Escrever `src/modules/rag/client.test.ts` com um servidor `node:http` local em porta 0: resposta 200 com `answer` devolve o objeto `RagAnswer`.
- [X] T020 [P] [US1] Escrever `src/modules/whatsapp/handle-message.test.ts` com `ask`, `send` e `log` falsos:
  - mensagem nova → `ask` recebe o texto e `send` recebe `(phone, answer)`;
  - mesma mensagem (mesmo `id`) duas vezes → `ask` e `send` chamados uma única vez.

### Implementation for User Story 1

- [X] T021 [US1] Em `src/modules/whatsapp/evolution.ts`:
  - acrescentar `id: string` a `IncomingMessage` e `id?: string` ao tipo de `key` em `parseIncomingMessage`;
  - devolver `null` quando faltar `key.id` ou quando `text.trim()` for vazio, além das regras atuais;
  - incluir `id` no retorno (ver [data-model.md](data-model.md#incomingmessage-node-srcmoduleswhatsappevolutionts)).
- [X] T022 [P] [US1] Criar `src/modules/whatsapp/dedupe.ts` com `createSeenMessages({ ttlMs = 600_000, capacity = 1000, now = Date.now } = {})`, que devolve `{ markSeen(id: string): boolean }`. Usa um `Map<string, number>` com a expiração; ao inserir, remove entradas vencidas e as mais antigas enquanto `size > capacity`.
- [X] T023 [P] [US1] Criar `src/modules/rag/client.ts`, sem importar `env`:
  - interfaces `RetrievedChunk` e `RagAnswer` iguais ao [contrato](contracts/rag-service.md#post-answer);
  - classe `RagUnavailableError extends Error` com `cause`;
  - `createRagClient({ baseUrl, timeoutMs })`, que devolve `{ ask(question: string): Promise<RagAnswer> }`;
  - `ask` faz `fetch(new URL("/answer", baseUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal: AbortSignal.timeout(timeoutMs) })`.
- [X] T024 [US1] Criar `src/modules/whatsapp/handle-message.ts` com `createMessageHandler({ ask, send, seen })`, que devolve `(message: IncomingMessage, log: FastifyBaseLogger) => Promise<void>`.
  - Fluxo: `seen.markSeen(message.id)` falso → retorna. Senão, `const result = await ask(message.text)`, depois `await send(message.phone, result.answer)` e `log.info({ phone, latency_s }, "resposta enviada")`.
  - O texto da mensagem não vai para o log.
- [X] T025 [US1] Em `src/routes/evolution-webhook.ts`:
  - criar, no escopo do módulo, `const handleMessage = createMessageHandler({ ask: createRagClient({ baseUrl: env.RAG_SERVICE_URL, timeoutMs: env.RAG_TIMEOUT_MS }).ask, send: sendWhatsAppText, seen: createSeenMessages() })`;
  - no lugar do TODO, chamar `void handleMessage(message, req.log).catch((err) => req.log.error({ err, phone: message.phone }, "falha ao responder mensagem"))`, sem `await`, mantendo o `return reply.code(200).send()` imediato (FR-013, FR-014).
- [X] T026 [US1] Rodar `npm test` e `npm run typecheck`: tudo passa. Com o serviço RAG no ar, validar o [quickstart.md §3 e §4](quickstart.md#3-contratos-do-serviço). "How much are braces?" recebe $180–$450 e $35–$90; "Do you accept dental insurance?" recebe a frase de recusa (SC-005). *(Validado com a Evolution API simulada em 2026-10-15; falta conferir no WhatsApp real.)*

**Checkpoint**: MVP. O cliente pergunta no WhatsApp e recebe a resposta do folheto.

---

## Phase 5: User Story 3 - O cliente nunca fica sem retorno (Priority: P2)

**Goal**: Com o assistente fora do ar, com erro ou lento, o cliente recebe a mensagem de indisponibilidade e o erro vai para o log.

**Independent Test**: [quickstart.md §5](quickstart.md#5-falha-do-assistente-us3).

### Tests for User Story 3

- [X] T027 [P] [US3] Acrescentar a `src/modules/rag/client.test.ts` os casos em que `ask` rejeita com `RagUnavailableError`:
  - servidor responde 500;
  - servidor responde 200 sem `answer` em string;
  - servidor demora mais que `timeoutMs` (por exemplo, `timeoutMs: 50` com o servidor atrasando 500 ms);
  - porta fechada (conexão recusada).
- [X] T028 [P] [US3] Acrescentar a `src/modules/whatsapp/handle-message.test.ts`:
  - `ask` rejeitando → `send` recebe `(phone, UNAVAILABLE_MESSAGE)` e `log.error` é chamado com `phone`;
  - `send` rejeitando → `log.error` é chamado e a promise do handler resolve, sem rejeitar.

### Implementation for User Story 3

- [X] T029 [US3] Em `src/modules/rag/client.ts`, transformar em `RagUnavailableError` (com a causa original) os seguintes casos: erro do `fetch` (rede ou `TimeoutError`/`AbortError`), `!res.ok` (incluir o status na mensagem), JSON inválido e `typeof body.answer !== "string"`.
- [X] T030 [US3] Em `src/modules/whatsapp/handle-message.ts`:
  - exportar `UNAVAILABLE_MESSAGE = "Sorry, our virtual assistant is unavailable right now. Please try again in a few minutes."`;
  - envolver `ask` em `try/catch`: na falha, `log.error({ phone, err }, "assistente indisponível")` e `send(phone, UNAVAILABLE_MESSAGE)`;
  - envolver todo `send` em `try/catch` com `log.error({ phone, err }, "falha ao enviar pelo WhatsApp")`, sem nova tentativa;
  - o handler nunca rejeita.
- [X] T031 [US3] Rodar `npm test`. Validar o [quickstart.md §5](quickstart.md#5-falha-do-assistente-us3): com o serviço parado, chega a mensagem de indisponibilidade; com `RAG_TIMEOUT_MS=1`, chega só ela, sem resposta atrasada (SC-004). *(Validado com a Evolution API simulada.)*

**Checkpoint**: Falhas do assistente nunca deixam o cliente sem retorno.

---

## Phase 6: User Story 4 - O desenvolvedor sabe se o assistente está pronto (Priority: P3)

**Goal**: `/health` informa Ollama e índice; o serviço se recusa a subir com índice ruim.

**Independent Test**: [quickstart.md §2](quickstart.md#2-o-serviço-sobe-só-com-o-índice-atual-us4).

### Tests for User Story 4

- [X] T032 [P] [US4] Acrescentar a `rag/tests/unit/test_server.py`, com monkeypatch de `server.ollama_reachable` e `server.index_state`:
  - pronto → 200, `status: ready`;
  - Ollama inacessível → 503, `ollama.reachable: false`;
  - índice `stale` → 503 com `index.reason`;
  - `main()` com `require_index` levantando `IndexUnavailable` → `SystemExit` código 1 e mensagem `Could not start:` com o comando;
  - `main()` com `SettingsError` → código 2.

### Implementation for User Story 4

- [X] T033 [US4] Em `rag/server.py`:
  - adicionar `ollama_reachable(url: str, timeout: float = 2.0) -> bool`, que faz `GET {url}/api/tags` com `urllib.request` e devolve `False` em qualquer exceção ou status diferente de 2xx;
  - adicionar `GET /health`, que monta o corpo de [contracts/rag-service.md](contracts/rag-service.md#get-health) com `OLLAMA_BASE_URL`, `index_state(get_strategy(config.strategy))` e `config.experiment`. Responde 200 se `ready`, senão `JSONResponse(status_code=503)`.
- [X] T034 [US4] Em `rag/server.py`, fazer `main()` repetir a checagem de `assistant/chat.py` antes do `uvicorn.run`:
  - `RagConfig()` + `require_index(get_strategy(config.strategy))`;
  - `SettingsError` → imprime `Invalid configuration: N problem(s)` e uma linha por problema, e chama `sys.exit(2)`;
  - `IndexUnavailable` → imprime `Could not start: {error}` e chama `sys.exit(1)`;
  - o Ollama fora do ar não impede a subida (FR-011).
- [X] T035 [US4] Rodar `.venv/Scripts/python.exe -m pytest` em `rag/`. Validar o [quickstart.md §2](quickstart.md#2-o-serviço-sobe-só-com-o-índice-atual-us4), incluindo a recusa com o `manifest.json` renomeado; desfazer a renomeação ao fim.

**Checkpoint**: Todas as stories funcionam.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T036 [P] Criar `rag/README.md` (em inglês) explicando:
  - origem (RagLab, commit `4913779`) e o que foi mantido igual;
  - o que foi acrescentado (`server.py`, atalho `serve`, `test_server.py`);
  - a tabela de comandos (`.\run.ps1 help`);
  - as regras do RagLab que continuam valendo: medir com `evaluation run --no-judge` antes de mudar prompt, sinônimos, chunking ou busca; manter `NO_ANSWER` e `ABSTENTION_PATTERNS` alinhados; `assistant` nunca importa `evaluation`; não ajustar com o holdout.
- [X] T037 [P] Atualizar o `README.md` da raiz (FR-020):
  - na Stack, acrescentar o assistente RAG (Python 3.14 + Ollama, em `rag/`);
  - na Estrutura, acrescentar `rag/` e `src/modules/rag/`;
  - nova seção "Assistente RAG (DentalSafe)" com: pré-requisitos (Python 3.14, Ollama com `ollama pull llama3` e `ollama pull nomic-embed-text`), `python -m venv .venv` + `.\run.ps1 install` + `.\run.ps1 ingest` + `.\run.ps1 serve` dentro de `rag/`, a verificação em `GET http://127.0.0.1:8001/health`, as variáveis `RAG_SERVICE_URL`/`RAG_TIMEOUT_MS`, o aviso de que o assistente responde em inglês e de que `ANTHROPIC_API_KEY` precisa de qualquer valor, e o `npm test`.
- [ ] T038 Validar o [quickstart.md](quickstart.md) inteiro, do §1 ao §5, numa sessão só. Medir 10 perguntas pelo WhatsApp com o modelo já carregado: pelo menos 9 respondidas em até 10 s (SC-003). *(Pendente: precisa do WhatsApp real. SC-003 medido com a Evolution API simulada: 10 de 10 em até 2,5 s.)*

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002 → T003. T004 é independente. T005 depende de T001, e T006 depende de T005.
- **Foundational (Phase 2)**: depende da Phase 1. T007 → T008/T009; T010 e T011 são independentes da parte Python; T012 fecha a fase.
- **US2 (Phase 3)**: depende só da Phase 1 (T006). Pode rodar em paralelo com a Phase 2, porque não usa o servidor.
- **US1 (Phase 4)**: depende da Phase 2.
- **US3 (Phase 5)**: depende da US1, porque altera `client.ts` e `handle-message.ts`, criados em T023/T024.
- **US4 (Phase 6)**: depende só da Phase 2, porque mexe apenas em `rag/server.py`. Pode rodar em paralelo com a US1 e a US3.
- **Polish (Phase 7)**: depende de todas.

### User Story Dependencies

```text
Setup ─┬─▶ US2 (validação da cópia)
       └─▶ Foundational ─┬─▶ US1 ─▶ US3
                         └─▶ US4
                                     └──▶ Polish (todas)
```

### Within Each User Story

- Testes escritos antes e falhando; a implementação vem depois.
- `evolution.ts` (T021) antes de `handle-message.ts` (T024), porque o handler usa `message.id`.
- `dedupe.ts` (T022) e `client.ts` (T023) antes de `handle-message.ts` (T024) e da rota (T025).

### Parallel Opportunities

- Phase 1: T004 em paralelo com T001–T003.
- Phase 2: T008, T009, T010 e T011 em paralelo depois de T007 (T010 e T011 nem dependem de T007).
- US2 inteira em paralelo com a Phase 2.
- US1: T017–T020 em paralelo; T022 e T023 em paralelo.
- US4 em paralelo com US1/US3, porque mexe em arquivos diferentes.
- Polish: T036 e T037 em paralelo.

---

## Parallel Example: User Story 1

```text
# Testes da US1 juntos:
Task: "Testes do parser em src/modules/whatsapp/evolution.test.ts"
Task: "Testes do dedupe em src/modules/whatsapp/dedupe.test.ts"
Task: "Teste de sucesso do cliente em src/modules/rag/client.test.ts"
Task: "Testes do handler em src/modules/whatsapp/handle-message.test.ts"

# Módulos independentes da US1 juntos:
Task: "createSeenMessages em src/modules/whatsapp/dedupe.ts"
Task: "createRagClient em src/modules/rag/client.ts"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup), depois Phase 2 (Foundational) e Phase 3 (US2). A US2 é barata e confirma que a base está boa antes de qualquer integração.
2. Phase 4 (US1).
3. **PARAR E VALIDAR**: perguntar pelo WhatsApp e conferir as respostas (T026).

### Incremental Delivery

1. Setup + Foundational + US2 → assistente copiado, medido e servindo HTTP.
2. + US1 → MVP no WhatsApp.
3. + US3 → robusto a falhas do assistente.
4. + US4 → diagnóstico e recusa de índice ruim.
5. + Polish → documentação e validação completa.

---

## Notes

- Nunca alterar os arquivos em `C:\Users\Filipi\Desktop\Projects\RagLab`. Ele é só a origem da cópia.
- Os únicos arquivos vindos do RagLab que podem mudar são `rag/requirements.txt` (T005), `rag/run.ps1`, `rag/Makefile` e `rag/tests/unit/test_shortcuts.py` (T008; o teste lista os atalhos esperados). Qualquer outra diferença em relação à origem é um erro.
- Uma ou duas questões de diferença na avaliação são ruído do llama3. Confirmar com `--repeat 3` antes de concluir que houve regressão.
- Commit ao fim de cada fase; a spec não pede branch, mas convém criar `001-rag-whatsapp-dentalsafe` antes de T001.
