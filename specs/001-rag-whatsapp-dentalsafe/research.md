# Research: Respostas da DentalSafe pelo WhatsApp com o RAG do RagLab

Decisões técnicas da Fase 0. Cada uma resolve um ponto que a spec deixou aberto ou que o Technical Context do [plan.md](plan.md) marcou como desconhecido.

## R1. Como trazer o RagLab para o repositório

**Decision**: Fazer uma cópia simples dos arquivos para `rag/`, sem histórico git. O pipeline e a avaliação não mudam. A única alteração em arquivo vindo do RagLab é adicionar o atalho `serve` ao `Makefile` e ao `run.ps1`, sempre nos dois, porque o `tests/unit/test_shortcuts.py` falha se um divergir do outro.

**Rationale**: A spec (FR-001) pede cópia sem submódulo. O `assistant/config.py` resolve todos os caminhos a partir de `ROOT = Path(__file__).parents[1]`, então o código funciona em `rag/` sem ajustes. O `evaluation/history.py` chama o git para registrar o commit de cada execução, e isso continua funcionando de dentro de uma subpasta do repositório do Secretaryfy.

**Alternatives considered**:
- *git subtree com histórico*: traria os commits do RagLab para o log do Secretaryfy sem ganho prático, já que os dois projetos vão divergir.
- *Submódulo*: descartado pela spec.
- *Pacote pip instalado do RagLab*: exigiria transformar o RagLab em biblioteca, que é exatamente o que decidimos adiar.

Lista exata do que entra (FR-002, FR-003):

| Entra | Não entra |
|---|---|
| `assistant/`, `evaluation/` (sem `runs/*`), `config/`, `tests/`, `data/source/DentalSafe.pdf`, `requirements.txt`, `pytest.ini`, `.env.example`, `Makefile`, `run.ps1`, `.gitattributes` | `.venv/`, `data/index/`, `.pytest_cache/`, `__pycache__/`, `.specify/`, `specs/`, `.claude/`, `.vscode/`, `CLAUDE.md`, `docs/`, `README.md` |
| `evaluation/runs/baseline.json`, `evaluation/runs/.gitkeep`, `evaluation/runs/experiments/.gitkeep`, `evaluation/runs/20261011-191541/`, `evaluation/runs/20261011-132527-reference-holdout/` | As demais pastas de `evaluation/runs/` e os CSVs de `evaluation/runs/experiments/` |

## R2. Framework do serviço HTTP

**Decision**: Usar FastAPI com uvicorn. Os endpoints são funções `def` síncronas, que o FastAPI executa num threadpool. As versões ficam fixadas no `rag/requirements.txt`: `fastapi` na linha 0.142.x (não a mais nova; a versão exata é escolhida na implementação) e `uvicorn==0.54.0`, que já é dependência transitiva do `chromadb`. O `httpx==0.28.1`, que já está instalado, passa a ser explícito porque o `TestClient` precisa dele.

**Rationale**: O FastAPI valida a entrada com pydantic, o que atende o FR-012 (pergunta vazia vira 422 sem chamar o modelo), e tem um cliente de teste embutido. O pipeline do RagLab é síncrono (`ChatOllama.invoke`), então endpoints `def` evitam bloquear o event loop sem reescrever nada.

**Alternatives considered**:
- *`http.server` da biblioteca padrão*: zero dependências, mas validação, erros e testes ficariam todos à mão.
- *Flask*: equivalente, mas sem validação declarativa.
- *Endpoints `async`*: exigiria `run_in_threadpool` em volta de cada chamada ao pipeline, sem ganho.

## R3. Recusar subir com índice desatualizado

**Decision**: O `rag/server.py` faz a mesma checagem que o `assistant/chat.py`, ou seja, `RagConfig()` seguido de `require_index(get_strategy(config.strategy))`, antes de chamar `uvicorn.run`. Se a checagem falhar, imprime `Could not start: <motivo com o comando>` e sai com código 1. Configuração inválida (`SettingsError`) sai com código 2 e lista os problemas.

**Rationale**: É o comportamento que a spec pede (FR-011), com a mesma mensagem que o desenvolvedor já conhece do RagLab. Como a checagem roda antes do uvicorn, nenhuma porta é aberta com o serviço em estado ruim.

**Alternatives considered**: Checar no `lifespan` do FastAPI. Funciona, mas o uvicorn imprime um traceback de erro de startup que esconde a mensagem útil.

## R4. Verificar se o Ollama está acessível

**Decision**: O `/health` faz `GET {OLLAMA_BASE_URL}/api/tags` com `urllib.request`, com tempo limite de 2 s. Responde 200 quando o Ollama está acessível e o índice está atualizado, e 503 caso contrário, sempre com o detalhe dos dois itens.

**Rationale**: `/api/tags` é a chamada mais barata do Ollama e não carrega modelo. Com `urllib`, não entra mais uma dependência. Devolver 503 permite que outros scripts usem o código HTTP sem ler o corpo.

**Alternatives considered**: Gerar um embedding de teste a cada health. Isso carregaria o modelo de embedding toda vez e deixaria o health lento.

## R5. Processamento em segundo plano no Node

**Decision**: O webhook valida o token, faz o parse da mensagem e dispara `handleIncomingMessage(message)` sem `await`, com `.catch` registrando o erro no log. Depois responde 200 na hora. Não há fila nesta fase.

**Rationale**: Atende o FR-013 com o mínimo de peças. Com Ollama local e um único desenvolvedor testando, o volume é de poucas mensagens por minuto.

**Alternatives considered**: Uma fila em Postgres ou uma lib de jobs. Isso garantiria entrega depois de reinícios, mas a spec descarta fila e nova tentativa nesta fase.

## R6. Tempo limite e "nenhuma resposta atrasada"

**Decision**: O cliente RAG em `src/modules/rag/client.ts` usa `fetch` com `signal: AbortSignal.timeout(env.RAG_TIMEOUT_MS)`, com padrão de 30000. Erro de rede, timeout, status diferente de 2xx ou corpo inválido viram um único `RagUnavailableError`, com a causa. Quando há timeout, a requisição é abortada e a resposta nunca chega ao Node, então não existe resposta atrasada para enviar depois da mensagem de indisponibilidade (spec, US3 cenário 2).

**Rationale**: O Node 24 já traz `fetch` e `AbortSignal.timeout`, então não entra dependência nova. Tratar todas as falhas como um único erro simplifica o handler: ou envia a resposta, ou envia a mensagem de indisponibilidade.

**Alternatives considered**: Usar `Promise.race` com um timer. A requisição continuaria em andamento e poderia resolver depois.

## R7. Responder uma única vez a um evento repetido

**Decision**: O `parseIncomingMessage` passa a devolver também `id` (`data.key.id`). Um módulo `src/modules/whatsapp/dedupe.ts` guarda os IDs vistos num `Map<string, number>` com validade de 10 minutos e limite de 1000 entradas, removendo os mais antigos quando passa do limite. Se o ID já foi visto, a mensagem é ignorada.

**Rationale**: As reentregas da Evolution API acontecem segundos ou minutos depois do evento original. A spec aceita que a deduplicação não sobreviva a reinícios.

**Alternatives considered**: Uma tabela no Postgres com chave única no ID. É mais robusta, mas exige migration e acesso ao banco para uma garantia que a spec não pede.

## R8. Variáveis de ambiente do Node

**Decision**: Duas variáveis novas em `src/config/env.ts`, validadas com zod: `RAG_SERVICE_URL` (`z.url()`, padrão `http://127.0.0.1:8001`) e `RAG_TIMEOUT_MS` (`z.coerce.number().int().positive()`, padrão `30000`). As duas também entram no `.env.example`.

**Rationale**: Segue o padrão das variáveis que já existem (FR-019).

**Observação**: O `env.ts` atual exige `ANTHROPIC_API_KEY` não vazia. Isso fica fora do escopo e não gera custo, porque nenhum código desta feature chama a Claude. Para testar sem chave real, basta preencher qualquer valor. O quickstart avisa isso.

## R9. Porta e endereço do serviço RAG

**Decision**: O serviço escuta em `127.0.0.1:8001`, com valores sobrescrevíveis por `RAG_HOST` e `RAG_PORT`, lidos do `rag/.env` pelo `server.py`.

**Rationale**: A porta 8001 não conflita com o Node (3000), a Evolution API (8080) e o Postgres (5432). Escutar só em loopback evita expor o assistente na rede.

## R10. Testes

**Decision**:
- **Python**: `rag/tests/unit/test_server.py` com `fastapi.testclient.TestClient` e `monkeypatch` em `retrieve`/`answer`/checagem do Ollama, sem Ollama de verdade. Cobre os contratos, 422 para pergunta vazia, 503 em falha do modelo e o health. Roda junto do `pytest` normal.
- **Node**: test runner nativo (`node --import tsx --test "src/**/*.test.ts"`), num script novo `npm test`, sem dependências novas. Cobre o cliente RAG (sucesso, timeout, status de erro, servidor fora), o handler da mensagem (resposta, indisponibilidade, duplicata), o dedupe e o parser (id, texto vazio).
- **Ponta a ponta**: manual, seguindo o [quickstart.md](quickstart.md).

**Rationale**: O Secretaryfy ainda não tem testes, e o runner nativo com o `tsx` que já está no projeto é o caminho de menor atrito. Já o RagLab tem a regra de que os testes unitários não dependem do Ollama, e os testes do servidor seguem essa regra.

**Alternatives considered**: Vitest. Funciona bem, mas seria uma dependência nova sem necessidade nesta fase.
