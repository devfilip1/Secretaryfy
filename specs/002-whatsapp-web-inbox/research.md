# Research: Painel web do WhatsApp

Decisões técnicas da Fase 0, consolidadas para o [plan.md](plan.md).

## R1. Front-end

**Decision**: SPA em React 19 + Vite 8 + TypeScript, na pasta `web/` do mesmo repositório, com CSS próprio e sem biblioteca de componentes. As dependências ficam no `package.json` da raiz, sem workspaces, com versões exatas publicadas há mais de duas semanas: `react@19.3.0`, `react-dom@19.3.0`, `vite@8.3.1`, `@vitejs/plugin-react@6.1.1`, `@types/react@19.3.0` e `@types/react-dom@19.3.0`.

**Rationale**: A interface de chat tem estado que muda o tempo todo (lista, conversa aberta, mensagens chegando, status da conexão). React deixa isso organizado, e o Vite dá recarga rápida e build estático simples. Um único `package.json` mantém o projeto com um só `npm install`.

**Alternatives considered**:
- *HTML gerado no servidor + htmx*: menos dependências, mas o tempo real e a rolagem infinita ficam mais trabalhosos.
- *Next.js*: SSR e roteamento que não fazem falta num painel interno, e um segundo servidor Node.
- *Biblioteca de UI* (MUI, shadcn): acelera, mas é peso desnecessário para quatro telas.

## R2. Como o painel é servido

**Decision**:
- **Desenvolvimento**: Vite em `http://localhost:5173`, com proxy de `/api` para o Fastify em `:3000`, SSE incluído.
- **Produção**: `npm run build` gera `web/dist/`, e o Fastify serve esses arquivos com `@fastify/static@10.1.5`. Qualquer rota que não seja `/api`, `/auth` ou `/webhooks` cai no `index.html`.

**Rationale**: Nos dois modos o navegador fala com uma só origem. Assim o cookie de sessão funciona com `SameSite=Strict` e não é preciso CORS.

## R3. Tempo real

**Decision**: Server-Sent Events em `GET /api/events`, alimentados por um barramento de eventos em memória (`EventEmitter`) no processo do Fastify. O servidor manda um comentário de heartbeat a cada 25 s. Quando o `EventSource` reconecta, o cliente busca de novo a lista de conversas e a conversa aberta, para não perder o que chegou enquanto estava desconectado.

**Rationale**: O fluxo em tempo real só vai do servidor para o navegador. O envio de mensagens já é um `POST` comum. SSE é HTTP puro, passa pelo proxy do Vite, leva o cookie automaticamente e reconecta sozinho. O refetch ao reconectar resolve o caso "servidor reiniciou" da spec sem precisar de replay de eventos.

**Alternatives considered**:
- *WebSocket* (`@fastify/websocket`): bidirecional sem necessidade, e a reconexão teria que ser escrita à mão.
- *Polling a cada 2 s*: simples, mas gasta requisições à toa e fica no limite do SC-001.

## R4. Login com acesso único

**Decision**:
- **Senha**: variável `OPERATOR_PASSWORD` (mínimo 12 caracteres), opcional no `env.ts`. Sem ela, todas as rotas `/api/*` respondem 503 `{"error":"panel_disabled"}` e o painel mostra uma tela explicando o que configurar (FR-023).
- **Comparação**: `timingSafeEqual` entre os SHA-256 da senha enviada e da configurada.
- **Sessão**: cookie `sf_session` com valor `sign("operator", 43200)`, reaproveitando `src/config/crypto.ts` com validade de 12 h. Atributos `HttpOnly`, `SameSite=Strict` e `Path=/`, mais `Secure` quando `PUBLIC_URL` for `https`. O cookie é lido com `@fastify/cookie@11.1.2`.
- **Logout**: apaga o cookie (FR-025, "naquele navegador").
- **Limite de tentativas**: até 5 falhas por IP em 15 min; a partir daí, 429 até a janela passar. O contador fica em memória (FR-024).
- **CSRF**: `SameSite=Strict`, e os `POST` da API só aceitam `Content-Type: application/json`.

**Rationale**: Atende ao acesso único escolhido na spec com o que o projeto já tem, sem tabela de sessões. Como a sessão não tem estado no servidor, não dá para revogá-la de lá. A spec só pede encerrar o acesso no navegador, e trocar o `APP_SECRET` invalida todas as sessões se for preciso.

**Alternatives considered**: Sessões no Postgres com revogação, mais pesado do que a fase pede. Basic Auth, que não tem logout de verdade e mostra o diálogo nativo do navegador.

## R5. Registro das mensagens

**Decision**: Duas tabelas novas, `conversations` e `messages`, detalhadas no [data-model.md](data-model.md). A coluna `messages.wa_message_id` é única e é ela que impede o mesmo evento de entrar duas vezes (FR-004), usando `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Isso substitui o `src/modules/whatsapp/dedupe.ts` da feature 001, que era em memória e perdia os IDs ao reiniciar o servidor.

**Rationale**: A chave única no banco já resolve a duplicidade, e de quebra a deduplicação passa a sobreviver a reinícios.

## R6. Eco das mensagens enviadas

As mensagens que o próprio sistema envia (assistente e operador) voltam pela Evolution API como evento.

**Decision**:
1. Antes de chamar a Evolution API, o envio grava a mensagem com `status = sending` e `wa_message_id = null`.
2. A resposta do `sendText` traz `key.id`. Com ele, a linha passa a ter `wa_message_id` preenchido e `status = sent`. Em caso de falha, fica `status = failed`.
3. Quando chega um evento `fromMe` com um ID que já existe, ele é ignorado.
4. Quando chega um `fromMe` com ID desconhecido, procura-se na mesma conversa uma linha `sending` com o mesmo texto, criada nos últimos 60 s. Se existir, o ID é anexado a ela. É o caso em que o eco chega antes da resposta do `sendText`.
5. Se não existir, a mensagem foi enviada pelo celular: entra com `origin = phone`.

**Rationale**: Cobre as duas ordens possíveis de chegada sem depender do comportamento exato de cada versão da Evolution API.

## R7. Eventos da Evolution API

**Decision**: O webhook (`POST /webhooks/evolution`) passa a tratar quatro eventos:

| Evento | O que faz |
|---|---|
| `messages.upsert` | Mensagens recebidas e as enviadas pelo celular |
| `send.message` | Eco das mensagens enviadas pela API |
| `connection.update` | Estado da conexão |
| `qrcode.updated` | QR code novo |

O formato está em [contracts/evolution.md](contracts/evolution.md). O tipo da mídia vem da chave presente em `data.message`: `audioMessage`, `imageMessage`, `videoMessage`, `documentMessage`, `stickerMessage`, `locationMessage`, `contactMessage` ou `contactsArrayMessage`. A legenda de imagem e de vídeo é guardada como texto.

**Rationale**: São os eventos da Evolution API v2 que cobrem mensagens e conexão. Com `webhookByEvents: false`, todos chegam na mesma URL, que já existe.

**Risco**: A Evolution API não está rodando nesta máquina, então os nomes dos eventos e dos endpoints vêm da documentação da v2. O primeiro passo do quickstart confere isso contra a instância real. Se algum nome divergir, a correção fica só em `src/modules/whatsapp/`.

## R8. Conexão do WhatsApp

**Decision**: Um módulo novo, `src/modules/whatsapp/instance.ts`, envolve as chamadas da Evolution API v2:

| Operação | Endpoint |
|---|---|
| Estado da conexão | `GET /instance/connectionState/{instance}` (`open`, `connecting` ou `close`) |
| Número conectado | `GET /instance/fetchInstances?instanceName={instance}` (`ownerJid`) |
| QR code | `GET /instance/connect/{instance}` (`base64` com a imagem PNG) |
| Desconectar | `DELETE /instance/logout/{instance}` |
| Criar a instância, se ela não existir | `POST /instance/create` com `{ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }` |
| Configurar o webhook (FR-019) | `POST /webhook/set/{instance}`, apontando para `${PUBLIC_URL}/webhooks/evolution?token=${EVOLUTION_WEBHOOK_TOKEN}` com os quatro eventos da R7 |

O servidor guarda em memória o último estado conhecido. Os eventos `connection.update` atualizam esse estado e o painel recebe a mudança por SSE. Para não depender só dos eventos, enquanto houver algum painel conectado o servidor consulta `connectionState` a cada 10 s.

Para o QR code, o evento `qrcode.updated` empurra o novo pelo SSE. Se ele não chegar, o painel pede um QR code novo a cada 30 s enquanto o estado não for `open` (FR-016).

O webhook é configurado sempre que o operador pede um QR code. Isso cobre tanto a instância recém-criada quanto uma `PUBLIC_URL` que mudou.

**Rationale**: O operador conecta o número sem tocar na Evolution API (FR-019), e o estado mostrado não fica desatualizado se um evento se perder.

## R9. Pausa do assistente

**Decision**: A coluna `conversations.assistant_paused` (boolean, padrão `false`) controla a pausa. O handler da feature 001 consulta a pausa duas vezes:

1. **Antes de perguntar ao assistente**: se a conversa estiver pausada, não pergunta.
2. **Depois da resposta e antes de enviar**: se a conversa foi pausada nesse meio-tempo, descarta a resposta (FR-022b).

O envio pelo operador grava `assistant_paused = true` na mesma transação em que insere a mensagem (FR-022a).

## R10. Paginação e busca

**Decision**:
- **Lista de conversas**: até 100 por vez, ordenadas por `last_message_at desc`. O parâmetro `q` filtra por nome ou número com `ILIKE` (FR-009).
- **Mensagens**: páginas de 50 com cursor `before=<id da mensagem mais antiga carregada>`, usando o índice `(conversation_id, sent_at desc, id desc)`. Ver [contracts/panel-api.md](contracts/panel-api.md).

**Rationale**: É o que mantém dentro dos 2 s do SC-006 uma conversa com 500 mensagens, sem trazer tudo de uma vez.

## R11. Horário das mensagens

**Decision**:
- **Mensagens recebidas** e **ecos do celular**: `sent_at` vem de `data.messageTimestamp` (em segundos), com o horário de chegada como alternativa se o campo faltar.
- **Mensagens enviadas pelo sistema**: `sent_at` é o momento da gravação.

O navegador mostra o horário no fuso local.

## R12. Testes

**Decision**:
- **Back-end, sem banco**: `node:test`, como na feature 001. Cobre o parser dos eventos, a regra de eco, o handler com pausa, o login e o limite de tentativas, a sessão e o barramento SSE.
- **Back-end, com Postgres**: testes do repositório e do service rodam contra `DATABASE_URL_TEST` quando definida. Sem ela, usam um Postgres em memória (PGlite, só em desenvolvimento), com as mesmas migrations. *Mudado na implementação: antes eles eram pulados sem a variável.* Usam um banco `secretaryfy_test` no mesmo Postgres do `docker compose`, aplicando as migrations antes.
- **Front-end**: sem testes automatizados nesta fase. Fica garantido por `tsc` (no `vite build`) e pelo roteiro manual do [quickstart.md](quickstart.md).

**Rationale**: As regras com risco de erro (eco, deduplicação, pausa, acesso) estão no back-end. O front-end é sobretudo apresentação, e testá-lo agora custaria uma dependência nova (Vitest + Testing Library) sem ganho proporcional.
