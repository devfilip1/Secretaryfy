# Secretaryfy

Assistente de IA no WhatsApp (via Evolution API) que atende os clientes de uma clínica e marca horários no Google Agenda dela.

Nesta fase, as mensagens de texto recebidas são respondidas pelo assistente da clínica fictícia **DentalSafe**. Ele vem do projeto RagLab, roda localmente com Ollama e fica em [`rag/`](rag/README.md). Um **painel web** mostra as conversas, permite responder pelo navegador, pausar o assistente por conversa e conectar o número pelo QR code. Com o **Google Agenda** conectado, o assistente consulta os horários livres e marca, cancela e remarca avaliações pela conversa.

## Stack

- Node 24 + TypeScript · Fastify · Postgres + Drizzle ORM · googleapis · Claude API (`@anthropic-ai/sdk`)
- Painel web: React 19 + Vite, em `web/`
- Agendamento: Luxon (datas e fusos) · Ollama local (`llama3`) só para interpretar a mensagem do cliente
- Assistente RAG: Python 3.14 · LangChain · Chroma · rank-bm25 · FastAPI · Ollama (`llama3`, `nomic-embed-text`), em `rag/`

## Rodando localmente

São três processos: o assistente RAG (Python), o servidor (Node) e, em desenvolvimento, o painel (Vite).

### 1. Assistente RAG (DentalSafe)

Requer Python 3.14 e o [Ollama](https://ollama.com) no ar:

```powershell
ollama pull llama3
ollama pull nomic-embed-text

cd rag
python -m venv .venv
.\run.ps1 install
.\run.ps1 ingest     # constrói os índices em rag/data/index/
.\run.ps1 serve      # http://127.0.0.1:8001
```

Para conferir se ele está pronto, abra `GET http://127.0.0.1:8001/health`. A resposta é `200` com `"status": "ready"`. Se der `503`, o corpo diz se o problema é o Ollama ou o índice. O serviço não sobe com o índice ausente ou desatualizado e mostra o comando que resolve. Os comandos de avaliação estão em [rag/README.md](rag/README.md).

### 2. Servidor

```bash
npm install
cp .env.example .env        # preencha as variáveis
docker compose up -d        # Postgres (porta 5434), Redis e Evolution API v2.3.7 (porta 8080)
npm run db:migrate
npm run dev                 # http://localhost:3000
```

O `docker compose` precisa do Docker Desktop aberto. A Evolution API usa a `EVOLUTION_API_KEY` do `.env` como chave dela e guarda seus dados no mesmo Postgres, no schema `evolution_api`. Como ela roda dentro do Docker, chama o webhook por `WEBHOOK_BASE_URL` (`http://host.docker.internal:3000`), e não por `PUBLIC_URL`. Para ver os logs: `docker compose logs -f evolution`.

| Variável | Padrão | Uso |
|---|---|---|
| `OPERATOR_PASSWORD` | — | Senha do painel, com 12 caracteres ou mais. Sem ela, o painel fica desligado |
| `WEBHOOK_BASE_URL` | `PUBLIC_URL` | Endereço do servidor como a Evolution API o enxerga |
| `RAG_SERVICE_URL` | `http://127.0.0.1:8001` | Endereço do assistente RAG |
| `RAG_TIMEOUT_MS` | `30000` | Tempo limite da resposta do assistente. Passou disso, o cliente recebe a mensagem de indisponibilidade |
| `DATABASE_URL_TEST` | — | Postgres para os testes do repositório. Sem ela, os testes usam um Postgres em memória (PGlite) |

`ANTHROPIC_API_KEY` precisa ter algum valor para o servidor subir, mas o atendimento atual não chama a Claude. Qualquer valor serve.

`PUBLIC_URL` precisa ser alcançável pela Evolution API: o painel usa esse endereço para configurar o webhook automaticamente.

### 3. Painel web

```bash
npm run dev:web             # http://localhost:5173 (repassa /api para o servidor em :3000)
```

Em produção, o servidor entrega o painel compilado na mesma porta:

```bash
npm run build               # compila o servidor (dist/) e o painel (web/dist/)
npm start                   # painel e API em http://localhost:3000
```

**No painel:**

- **Login**: senha única (`OPERATOR_PASSWORD`). A sessão dura 12 h. Depois de 5 senhas erradas, o mesmo IP espera 15 min.
- **Conexão**: mostra se o WhatsApp está conectado. Desconectado, aparece um QR code para escanear em *WhatsApp > Aparelhos conectados*. O código se renova sozinho; se a Evolution API desistir depois de muitos códigos, aparece o botão "Gerar novo QR code". A instância e o webhook são configurados automaticamente.
- **Agenda**: conecta o Google Agenda da clínica, escolhe a agenda usada e define as regras de atendimento (ver abaixo).
- **Conversas**: lista com busca, não lidas e prévia. O histórico identifica cliente, assistente, operador e celular, e as mensagens novas aparecem sem recarregar. As mídias aparecem como aviso ("🎤 Áudio").
- **Responder**: Enter envia, Shift+Enter quebra a linha. Uma mensagem que falhou fica marcada e pode ser reenviada.
- **Assistente por conversa**: enviar uma mensagem pelo painel pausa o assistente naquela conversa. Ele só volta a responder quando o operador clicar em "Reativar".
- **Histórico**: começa quando a feature entra no ar. Conversas antigas do celular não são importadas.

Para medir uma conversa grande: `node --env-file=.env --import tsx scripts/seed-conversation.ts [telefone] [quantidade]`.

### 4. Google Agenda (agendamento)

Uma vez, no [Google Cloud Console](https://console.cloud.google.com/), no projeto do `GOOGLE_CLIENT_ID`:

1. **APIs e serviços > Biblioteca**: ative a **Google Calendar API**.
2. **Credenciais**, no cliente OAuth: acrescente a URI de redirecionamento `http://localhost:3000/auth/google/callback` (`${PUBLIC_URL}/auth/google/callback`).
3. **Tela de consentimento OAuth**: acrescente os escopos `calendar.events`, `calendar.calendarlist.readonly` e `calendar.events.freebusy`, e o Gmail da clínica como **usuário de teste**.

No `.env`, em desenvolvimento, `PANEL_URL=http://localhost:5173`, para o Google devolver o operador ao painel do Vite. `OLLAMA_URL`, `AGENT_MODEL` (padrão `llama3`) e `AGENT_TIMEOUT_MS` têm padrão e podem ficar de fora.

No painel, em **Agenda**: **Conectar Google Agenda**, autorize, escolha a agenda (recomendado: uma agenda só para os testes) e salve as regras. Padrão: segunda a sexta, das 9h às 18h, consultas de 60 min, antecedência mínima de 2 h, até 30 dias à frente e cancelamento ou remarcação até 24 h antes.

**Como o agendamento funciona** (`src/modules/scheduling/`, decisões em [specs/003-google-calendar-scheduling/research.md](specs/003-google-calendar-scheduling/research.md)):

- O `llama3` **só interpreta** a mensagem (marcar, ver horários, escolher a opção 2, "yes"…), com a saída restrita por JSON Schema. Números, sim/não, datas simples e horários citados são resolvidos por regras, sem o modelo. Quem decide o próximo passo, consulta a agenda e escreve a resposta é o código.
- Dias e horários vêm em **opções numeradas** (até 6), calculadas na hora a partir das regras e da ocupação da agenda. Qualquer evento ocupado bloqueia o horário.
- Nada é marcado sem o **"yes"** do cliente. Antes de criar o evento, a agenda é consultada de novo, e dois clientes não ficam com o mesmo horário.
- **Um horário futuro por número.** Quem já tem um recebe a oferta de remarcar. Cancelar e remarcar só valem até o prazo das regras.
- O **Google Agenda manda**: evento apagado ou movido direto no Google vale como cancelado ou com o horário novo.
- Dúvidas sobre a clínica no meio do agendamento continuam respondidas pelo folheto.
- Depois de **2 respostas que o assistente não entende**, ele avisa o cliente, pausa o assistente na conversa e a destaca no painel como "Precisa de atendimento".
- Cada marcação, cancelamento ou remarcação aparece no histórico da conversa (📅). O evento no Google leva o nome do cliente, o WhatsApp e "Marcado pelo Secretaryfy".

**Testar sem um segundo número**: o script manda ao webhook uma mensagem de cliente com o seu próprio número, e a resposta chega no chat "Você" do WhatsApp:

```bash
npx tsx --env-file=.env scripts/simulate-customer.ts "I'd like to book an appointment"
npx tsx --env-file=.env scripts/simulate-customer.ts "2"
```

**Medir com o modelo real** (20 conversas roteirizadas, agenda falsa; critérios SC-002 a SC-005 e SC-008 da spec):

```bash
npx tsx --env-file=.env scripts/eval-scheduling.ts
AGENT_MODEL=llama3.1:8b npx tsx --env-file=.env scripts/eval-scheduling.ts   # comparar outro modelo
```

O roteiro completo de validação está em [specs/003-google-calendar-scheduling/quickstart.md](specs/003-google-calendar-scheduling/quickstart.md).

### Como o atendimento se comporta

- O webhook responde `200` na hora; o registro da mensagem e o assistente rodam em segundo plano.
- Toda mensagem individual (cliente, assistente, operador e celular) fica gravada no Postgres. O mesmo evento entregue duas vezes é registrado e respondido uma vez só, mesmo depois de um reinício.
- O assistente **responde sempre em inglês**, como determina o prompt da DentalSafe. Perguntas em português podem receber a informação errada, porque os sinônimos da busca estão em inglês.
- Se o assistente estiver fora do ar, com erro ou passar do tempo limite, o cliente recebe uma mensagem curta de indisponibilidade e o erro vai para o log.
- Mensagens que não são texto (áudio, imagem) são registradas, mas não vão para o assistente. Grupos são ignorados.
- Antes de responder, a mensagem é interpretada: pedidos de agendamento vão para o fluxo de agendamento, o resto vai para o folheto. O interpretador vê as últimas 20 mensagens da conversa; as respostas do folheto continuam sem histórico.

### Testes

```bash
npm test                         # testes do servidor (Postgres em memória, sem rede)
npm run typecheck                # servidor e painel
cd rag && .\run.ps1 test         # testes do assistente, sem Ollama
```

## Estrutura

```
src/
  config/       env (validado com zod) e criptografia de tokens / assinatura de sessão e OAuth
  db/           schema e cliente Drizzle
  modules/
    auth/       senha do operador, cookie de sessão e limite de tentativas
    google/     OAuth e conexão da agenda da clínica, chamadas ao Google Calendar
    inbox/      conversas e mensagens: registro, eco dos envios, pausa, eventos em tempo real
    rag/        cliente do serviço RAG (POST /answer, com tempo limite)
    scheduling/ agendamento: regras, horários livres, interpretador (Ollama), máquina de estados e roteador
    whatsapp/   Evolution API: parser dos eventos, envio, conexão/QR code e resposta do assistente
  routes/       /health, /auth/google/callback, /webhooks/evolution, /api/* do painel (inclusive /api/calendar*)
  test/         preparação dos testes (env e banco em memória)
web/            painel (React + Vite)
scripts/        utilitários: seed de conversa, simular cliente, avaliação do agendamento
drizzle/        migrations geradas (npm run db:generate)
rag/            assistente da DentalSafe, copiado do RagLab (ver rag/README.md)
```

## Endpoints

| Rota | Uso |
|---|---|
| `GET /health` | Healthcheck |
| `GET /auth/google/callback` | Volta do OAuth do Google (conexão da agenda) |
| `POST /webhooks/evolution?token=...` | Webhook da Evolution API (`messages.upsert`, `send.message`, `connection.update`, `qrcode.updated`) |
| `/api/*` | API do painel, com login; contratos em [specs/002-whatsapp-web-inbox/contracts/panel-api.md](specs/002-whatsapp-web-inbox/contracts/panel-api.md) e [specs/003-google-calendar-scheduling/contracts/panel-api.md](specs/003-google-calendar-scheduling/contracts/panel-api.md) |

O assistente RAG tem os próprios endpoints (`/health`, `/answer`, `/retrieve`), descritos em [rag/README.md](rag/README.md).
