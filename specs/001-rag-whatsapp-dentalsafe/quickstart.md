# Quickstart: validar a feature de ponta a ponta

Roteiro para provar que a feature funciona. Os comandos de preparação do ambiente vão para o README (FR-020); aqui ficam os passos de verificação e o resultado esperado em cada um.

## Pré-requisitos

- Python 3.14, Node 24, Docker.
- Ollama rodando, com `llama3` e `nomic-embed-text` baixados (`ollama list` mostra os dois).
- Evolution API com uma instância conectada a um WhatsApp de teste e o webhook apontando para `${PUBLIC_URL}/webhooks/evolution?token=...`, evento `messages.upsert`.
- `.env` do Secretaryfy preenchido. `ANTHROPIC_API_KEY` precisa ter algum valor, mas não é usada nesta feature (ver [research.md R8](research.md#r8-variáveis-de-ambiente-do-node)).

## 1. O assistente copiado mantém a qualidade (US2)

Dentro de `rag/`:

```powershell
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest
.\run.ps1 test
.\run.ps1 validate
.\run.ps1 kb-check
.\run.ps1 experiments
.\run.ps1 eval
```

| Passo | Esperado |
|---|---|
| `ingest` | Estratégia `section` com 11 chunks |
| `test` | Todos os testes unitários passam, incluindo `test_server.py` e `test_shortcuts.py` |
| `validate` | Configuração e gabarito válidos |
| `kb-check` | 0 duplicados, 0 fatos sem âncora, 0 chunks corrompidos |
| `experiments` | `section_hybrid` com 44/44 |
| `eval` | Entre 47 e 51 de 51, com a comparação contra a referência `20261011-191541` aparecendo (SC-001) |

Se `eval` ficar fora da faixa, rode `.\run.ps1 eval --repeat 3` antes de concluir que algo quebrou. Diferença de uma ou duas questões é ruído do llama3.

## 2. O serviço sobe só com o índice atual (US4)

```powershell
.\run.ps1 serve
```

- **Esperado**: o uvicorn escuta em `127.0.0.1:8001`.
- `GET http://127.0.0.1:8001/health` → 200, `status: ready`.
- Com o serviço parado, renomeie `data/index/section/manifest.json` e rode `serve` de novo. Ele deve recusar com `Could not start: ... run: python -m assistant.ingest section` e código 1. Desfaça a renomeação depois.
- Com o Ollama parado e o serviço no ar: `/health` → 503, `ollama.reachable: false`.

## 3. Contratos do serviço

Com o serviço no ar (formatos em [contracts/rag-service.md](contracts/rag-service.md)):

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8001/answer -ContentType application/json -Body '{"question":"How much are braces?"}'
Invoke-RestMethod -Method Post http://127.0.0.1:8001/retrieve -ContentType application/json -Body '{"question":"How much are braces?"}'
Invoke-RestMethod -Method Post http://127.0.0.1:8001/answer -ContentType application/json -Body '{"question":"   "}'
```

| Chamada | Esperado |
|---|---|
| `/answer` | `answer` com $180–$450 e $35–$90, `chunks` com o trecho de braces, `experiment: section_hybrid` |
| `/retrieve` | `chunks` sem `answer` |
| pergunta vazia | 422 |

## 4. Atendimento pelo WhatsApp (US1)

Na raiz do Secretaryfy, com o serviço RAG no ar:

```powershell
docker compose up -d
npm test
npm run dev
```

Do WhatsApp de teste, envie:

| Mensagem | Esperado no WhatsApp |
|---|---|
| `How much are braces?` | Os valores de braces do folheto, em até 10 s (SC-003, SC-005) |
| `Do you accept dental insurance?` | Começa com "I don't have that information right now." |
| `Quanto custa o clareamento?` | Resposta em inglês |
| Um áudio ou uma imagem | Nenhuma resposta |

No log do Node, cada evento do webhook aparece com resposta 200 imediata, antes de a resposta do assistente ser enviada.

## 5. Falha do assistente (US3)

- Pare o serviço RAG e envie `How much are braces?`. **Esperado**: o cliente recebe a mensagem de indisponibilidade, o log do Node mostra um `error` com o telefone e o motivo, e a Evolution API não reenvia o evento (SC-004).
- Com o serviço no ar, defina `RAG_TIMEOUT_MS=1` no `.env` do Node, reinicie e envie uma pergunta. **Esperado**: chega só a mensagem de indisponibilidade, sem resposta atrasada depois. Restaure o valor ao terminar.
