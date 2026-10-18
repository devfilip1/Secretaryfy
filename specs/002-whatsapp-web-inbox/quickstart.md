# Quickstart: validar o painel de ponta a ponta

Roteiro para provar que a feature funciona. Cada passo indica a user story ou o critério da [spec](spec.md) que ele cobre.

## Pré-requisitos

- O ambiente da feature 001 funcionando: Postgres (`docker compose up -d`), assistente RAG (`.\run.ps1 serve` em `rag/`) e Ollama.
- A Evolution API v2 acessível em `EVOLUTION_API_URL`, com `EVOLUTION_API_KEY` válida.
- Um celular com um WhatsApp de teste, para conectar, e um segundo número, para fazer o papel do cliente.
- O `.env` com `OPERATOR_PASSWORD` (12 caracteres ou mais) e `PUBLIC_URL` alcançável pela Evolution API.

## 0. Conferir os nomes da Evolution API

Antes de implementar, verifique contra a instância real os nomes de [contracts/evolution.md](contracts/evolution.md). Isso trata o risco da [research.md R7](research.md#r7-eventos-da-evolution-api).

```powershell
$h = @{ apikey = $env:EVOLUTION_API_KEY }
Invoke-RestMethod "$env:EVOLUTION_API_URL/instance/connectionState/$env:EVOLUTION_INSTANCE" -Headers $h
Invoke-RestMethod "$env:EVOLUTION_API_URL/instance/fetchInstances?instanceName=$env:EVOLUTION_INSTANCE" -Headers $h
```

**Esperado**: `{ instance: { state: ... } }` e uma lista com `ownerJid`. Se o formato for outro, ajuste o contrato antes de seguir.

## 1. Preparar

```powershell
npm install
npm run db:migrate          # cria conversations e messages
npm test                    # testes do back-end
npm run dev                 # Fastify em :3000
npm run dev:web             # painel em http://localhost:5173
```

## 2. Acesso (US5, SC-007)

| Passo | Esperado |
|---|---|
| Abrir `http://localhost:5173` em janela anônima | Tela de login; nenhuma conversa visível |
| `Invoke-WebRequest http://localhost:3000/api/conversations` sem cookie | 401 |
| Errar a senha | "Senha inválida", mensagem genérica |
| Errar 5 vezes seguidas | Na 6ª tentativa, aviso para esperar (429) |
| Entrar com a senha certa | Lista de conversas |
| Sair | Volta ao login; recarregar a página não reabre o painel |
| Remover `OPERATOR_PASSWORD` e reiniciar o servidor | O painel mostra "Painel desativado: defina OPERATOR_PASSWORD"; a API responde 503 |

## 3. Conexão (US3, SC-003)

| Passo | Esperado |
|---|---|
| Com o número desconectado, abrir "Conexão" | QR code na tela; o indicador mostra "Desconectado" |
| Esperar mais de 30 s sem escanear | O QR code se renova sozinho |
| Escanear com o celular (Aparelhos conectados) | Em até 10 s: "Conectado" e o número, sem recarregar |
| Conferir o webhook na Evolution API (`GET /webhook/find/{instance}`) | URL `${PUBLIC_URL}/webhooks/evolution?token=...` com os 4 eventos (FR-019) |
| Desconectar o aparelho pelo celular | O painel mostra "Desconectado" em qualquer tela |
| Conectar de novo e usar "Desconectar" no painel, confirmando | Volta ao QR code |

## 4. Acompanhar conversas (US1, SC-001, SC-004)

Com o número conectado e o painel aberto na lista:

| Passo | Esperado |
|---|---|
| Do número do cliente, mandar `How much are braces?` | Em até 5 s, a conversa aparece no topo com a prévia e 1 não lida; logo depois chega a resposta do assistente |
| Abrir a conversa | Pergunta (cliente) e resposta (assistente) em ordem; não lidas zeram |
| Mandar um áudio e uma imagem com legenda | "🎤 Áudio" e "📷 Imagem — legenda" no histórico; sem resposta do assistente |
| Responder pelo app do celular conectado | A mensagem aparece como "Celular"; o assistente não responde a ela |
| Abrir o painel em um segundo navegador | Os dois recebem as mensagens novas |
| Buscar o cliente pelo nome ou por parte do número | A conversa é encontrada |
| Contar as mensagens no celular e no painel | Mesma quantidade, sem duplicatas |

## 5. Enviar e assumir (US2, US4, SC-002, SC-005)

| Passo | Esperado |
|---|---|
| Na conversa, enviar `Olá, sou da recepção` | Chega ao cliente em até 5 s; aparece como "Operador" com ✓; o cabeçalho mostra "Assistente pausado" |
| O cliente manda `How much is a dental cleaning?` | Aparece no painel; **nenhuma** resposta automática |
| Reativar o assistente e o cliente perguntar de novo | O assistente responde |
| Tentar enviar só espaços | Nada é enviado |
| Parar a Evolution API e enviar | Mensagem marcada "Falhou" com "Tentar de novo"; reativar a Evolution API e reenviar dá ✓ |
| Desconectar o número e tentar enviar | Envio bloqueado com aviso; o texto continua na caixa |

## 6. Resiliência e volume (edge cases, SC-006)

| Passo | Esperado |
|---|---|
| Reiniciar o servidor Node com o painel aberto e mandar uma mensagem durante a queda | O painel avisa "Reconectando…" e, ao voltar, mostra a mensagem |
| Popular uma conversa com 500 mensagens (`node scripts/seed-conversation.ts`, criado na implementação) e abri-la | Abre em até 2 s com as 50 mais recentes; rolar para cima carrega as anteriores |
| Reenviar o mesmo evento ao webhook com `curl` | Uma única mensagem no histórico |
