# Research: Proteção do número contra banimento (anti-ban)

Decisões técnicas da feature 004. A pesquisa dos comportamentos de risco está na tabela do [spec.md](spec.md#comportamentos-que-levam-ao-banimento-pesquisa).

## R1 — Um portão único para todo envio

- **Decision**: Todo envio ao WhatsApp, do assistente e do operador, passa por um único módulo `src/modules/antiban/`. Ele decide se a mensagem sai agora, espera na fila ou não sai. Fica proibido chamar `sendWhatsAppText` direto de outro lugar.
- **Rationale**: Os limites por minuto e por hora somam assistente e operador (FR-009). Com dois caminhos de envio, um deles escapa. Hoje há exatamente dois chamadores (`handle-message.ts` e `inbox.service.deliver`), e os dois passam a usar o portão.
- **Alternatives considered**:
  - Limitar na Evolution API: ela não tem limite por número, e o `delay` dela não espaça conversas diferentes.
  - Um proxy HTTP na frente da Evolution: mais uma peça para subir, sem ganho para um processo só.

## R2 — Contagens a partir do banco, fila em memória

- **Decision** (revisada na implementação):
  - **Contagens de minuto e hora:** ficam em memória, no portão, com o horário de cada envio feito. Na primeira vaga pedida, a lista é semeada do banco, com os envios `sent` da última hora; assim um reinício não zera os limites. Contar no banco as linhas `sending` não serve: as respostas que esperam na fila já estão gravadas como `sending` e travariam a própria fila.
  - **Contagem de 24 h** (conversas por dia): no banco, só com `sent`. O índice `messages_outgoing_sent_at_idx` cobre `sent`.
  - **Fila:** fica em memória, um array FIFO, com um único trabalhador que envia uma mensagem por vez.
  - **Reinício:** as mensagens do assistente que ficaram em `sending` passam a `blocked` com o motivo `restart` e não são reenviadas.
- **Rationale**: As contagens no banco sobrevivem a um reinício, então ninguém ganha uma janela "zerada" e manda rajada ao voltar. A fila de uma clínica tem poucas mensagens. Perder a fila num reinício é o comportamento desejado (edge case: "não reenviar em sequência na volta").
- **Alternatives considered**:
  - Redis, que já roda para a Evolution: coordenação entre processos que não existe aqui.
  - Fila persistida em tabela: reenviaria tudo ao reiniciar, justamente o que a spec proíbe.

## R3 — Lida, "digitando…" e espaçamento

- **Decision**:
  - **Marcar como lida:** `POST /chat/markMessageAsRead/{instance}` com os ids das mensagens do cliente desde a última resposta (FR-005). Uma falha aqui não impede a resposta.
  - **Quando visualizar (FR-005a, acrescentado em 2026-10-22):** num instante sorteado entre 2 e 8 s depois da última mensagem do cliente (média de dois sorteios, puxando para o meio). O tempo já gasto no agrupamento (4 s) e no modelo é descontado: se já passou, visualiza na hora.
  - **Pausa antes de digitar (FR-005b):** `clamp(600 ms + 30 ms × caracteres do cliente, 1 s, 3 s)` × fator aleatório entre 0,75 e 1,25. As duas esperas ficam fora da fila de envio, para não atrasar as outras conversas. Pior caso somado ao "digitando…" de antes: cerca de +7 s (resposta pronta antes dos 8 s + 3 s de pausa), o que pode passar do SC-007 (+15 s) só em respostas longas, que já têm 12 s de digitação; os quatro valores são ajustáveis (`ANTIBAN_READ_*`, `ANTIBAN_THINK_*`).
  - **"Digitando…":** usar o campo `delay` do `POST /message/sendText/{instance}`. Com ele, a própria Evolution mostra "digitando…" pelo tempo pedido e só então envia. Vai junto `linkPreview: false`.
  - **Duração:** `clamp(800 ms + 45 ms × caracteres, 2 s, 12 s)`, multiplicado por um fator aleatório entre 0,8 e 1,25 (FR-006, FR-008).
  - **Espaçamento:** entre dois envios quaisquer do número, um intervalo aleatório de 2 a 6 s, além do tempo de digitação (FR-010).
- **Rationale**: Uma chamada só por resposta, sem coordenar presença e envio à mão. O fator aleatório impede tempos fixos para textos do mesmo tamanho.
- **Alternatives considered**:
  - `POST /chat/sendPresence` seguido de `sendText`: duas chamadas, e a presença pode ficar presa se a segunda falhar.
  - Ritmo fixo de "digitação humana" (ex.: 40 palavras por minuto): respostas longas passariam de um minuto, contra o SC-007.

## R4 — Juntar mensagens seguidas do cliente

- **Decision**: O webhook continua registrando cada mensagem na hora. A decisão da resposta é que passa por um temporizador por conversa (`debounce`) de 4 s (FR-007). Cada mensagem nova reinicia o temporizador. Quando ele dispara, o assistente recebe o texto de todas as mensagens do cliente desde a última resposta, unidas por quebra de linha, e marca todas como lidas.
- **Rationale**: Hoje "oi" / "tudo bem?" / "queria marcar" geram três respostas seguidas, que é o sinal de robô e a insistência (FR-013) ao mesmo tempo. O roteador de agendamento já trabalha sobre texto livre, então três linhas juntas são uma mensagem válida para ele.
- **Alternatives considered**:
  - Responder só a última mensagem: perde contexto ("queria marcar" sozinho funciona, mas uma pergunta na primeira linha some).

## R5 — Laços com outro robô e insistência

- **Decision**: Uma função pura `assessConversation(recentMessages, now, limits)` olha as últimas 30 mensagens da conversa e devolve `ok`, `too_many_unanswered` ou `loop`:
  - **`too_many_unanswered`:** há 3 ou mais mensagens do assistente depois da última mensagem do cliente (FR-013).
  - **`loop` por resposta rápida:** nas últimas 5 trocas assistente → cliente, o cliente respondeu sempre em menos de 3 s depois da mensagem do assistente (FR-014).
  - **`loop` por volume:** 20 ou mais mensagens do assistente nos últimos 10 minutos (FR-014).

  Com `loop`, a conversa é pausada e destacada pelo `flagNeedsAttention` que já existe (feature 003), e o motivo vai para o registro `system` (FR-015).
- **Rationale**: Os sinais só dependem das mensagens que já estão em `messages`. Sendo pura, a função é fácil de testar com históricos montados.
- **Alternatives considered**:
  - Detectar robô pelo conteúdo, como textos de "menu" ou "digite 1": frágil, e o próprio assistente usa opções numeradas.

## R6 — Textos repetidos

- **Decision**:
  - **Repetição:** antes de enviar, procurar uma mensagem do assistente para o mesmo número com texto idêntico nos últimos 30 min. Se houver, a resposta não sai (`blocked`, motivo `duplicate`) (FR-016).
  - **Mensagens fixas:** a de indisponibilidade, a confirmação de saída e as de volta passam a ser listas de variações em `src/modules/antiban/texts.ts`. Elas não ficam em `replies.ts` porque ele já importa de `handle-message.ts`, e o caminho inverso criaria um import circular. O portão escolhe uma variação que não foi enviada àquele número nos últimos 30 min. Se todas foram, não envia (FR-017).
  - **Fora da regra:** os modelos do agendamento (feature 003) não entram nessa troca, porque repetir "Reply with the number" em etapas diferentes é esperado. A regra de duplicata vale para eles também, mas só para texto idêntico em sequência.
- **Rationale**: A comparação exata é barata e pega o caso real, o de laços e de "assistente indisponível" em série.
- **Alternatives considered**:
  - Similaridade aproximada: falsos positivos em respostas curtas ("Great!").

## R7 — Links

- **Decision**: Uma expressão para URLs (`https?://…`, `www.…` e domínios com TLD comum). Antes de enviar, o portão:
  - remove todas as URLs se for a primeira resposta do assistente na conversa;
  - nas demais respostas, remove as URLs cujo domínio não está em `ANTIBAN_ALLOWED_LINK_DOMAINS` (lista separada por vírgula, vazia por padrão).

  Uma URL removida vira o texto `(link removed)`. O envio segue e a remoção fica no log, sem o texto (FR-018).
- **Rationale**: O assistente não tem motivo para mandar links fora do domínio da clínica, e um link no primeiro contato é dos sinais mais citados.
- **Alternatives considered**:
  - Bloquear a resposta inteira: o cliente fica sem resposta por causa de um detalhe.
  - Detectar se o cliente "pediu" o link pelo conteúdo: subjetivo. A allowlist resolve o caso legítimo, o site da clínica.

## R8 — Janela de 24 horas e confirmação do operador

- **Decision**:
  - **Assistente:** o portão recusa (`blocked`, motivo `outside_window`) quando a última mensagem `customer` da conversa tem mais de 24 h ou não existe (FR-001).
  - **Operador:** `POST /api/conversations/:id/messages` e `POST /api/messages/:id/retry` aceitam `confirmRisk: true`. Sem ele, quando há risco, a rota responde `409 { error: "risk_confirmation_required", risks: [...] }`. Os riscos são `cold_contact`, `opted_out` e `protection_paused`. O painel mostra os riscos num diálogo próprio e reenvia com `confirmRisk: true` (FR-002, FR-027, US4).
- **Rationale**: O operador decide, como pede a spec, e a API continua sem estado: a confirmação vai no próprio pedido.
- **Alternatives considered**:
  - Bloquear o operador: contrário a FR-027 e ao edge case "o operador nunca é bloqueado sem aviso".

## R9 — Pedido de saída

- **Decision**:
  - **Reconhecimento:** por lista fixa, sem modelo de IA. A mensagem é normalizada (minúsculas, sem acento, sem pontuação nas pontas) e conta como saída se for igual a uma palavra ou frase de saída. Exemplos: `parar`, `pare`, `sair`, `stop`, `unsubscribe`, `cancelar mensagens`, `nao quero mais mensagens`, `para de mandar mensagem`. As palavras de volta são `voltar`, `start` e `quero voltar` (FR-019, FR-021).
  - **Onde roda:** antes do roteador de agendamento, no handler de mensagem, para valer mesmo com o Ollama fora do ar.
  - **Onde fica guardado:** a preferência fica em `contact_preferences`, por **telefone** e não por conversa. Ela sobrevive à limpeza das conversas ao desconectar (`clearAll`).
- **Rationale**: A igualdade com a lista evita o falso positivo "não quero parar o tratamento" (edge case). Guardar por telefone impede que desconectar e reconectar o número "esqueça" quem pediu para sair.
- **Alternatives considered**:
  - Pedir ao `llama3` que classifique: pode falhar justamente quando o assistente está fora, e erra frases negativas.

## R10 — Aquecimento

- **Decision**:
  - **Registro:** a tabela `connected_numbers` (número, `first_connected_at`) é gravada quando a conexão abre com um número (`connection.update` com `open`). Um número que não estava na tabela começa o aquecimento (FR-023).
  - **Limites:** sobem em linha reta, do inicial ao normal, ao longo de `ANTIBAN_WARMUP_DAYS` (padrão 14). Conversas por dia vão de 30 a 150, mensagens por minuto de 4 a 8, e as por hora acompanham na mesma proporção (FR-024).
  - **Encerrar antes:** `ANTIBAN_WARMUP_DAYS=0` desliga o aquecimento.
- **Rationale**: Não há como saber a idade real do número no WhatsApp. "Primeira vez neste Secretaryfy" é o melhor sinal disponível, e a rampa linear é simples de explicar no painel.
- **Alternatives considered**:
  - Degraus semanais: o limite salta de uma vez, que é o padrão que a pesquisa manda evitar.

## R11 — Freio automático

- **Decision**: O estado fica numa tabela de uma linha, `protection_state` (`paused_until`, `reason`), para sobreviver a um reinício.
  - **Disparo por falhas:** 5 envios que falharam nos últimos 10 min, contados em memória no momento da falha. Contar `failed` no banco perdia a corrida: o envio do operador grava `failed` depois de o portão avisar a falha.
  - **Disparo por quedas:** 3 eventos de conexão `close` em 30 min, guardados em memória pelo `instance` e repassados ao portão.
  - **Ao disparar:** `paused_until = now + 30 min`, a fila é esvaziada (cada item vira `blocked` com o motivo `paused`, e a conversa é destacada) e sai o evento SSE `protection.updated` (FR-026 a FR-028).
  - **Retomada:** é automática. A primeira consulta depois de `paused_until` limpa o estado e publica o evento.
- **Rationale**: É um disjuntor clássico, com estado mínimo. As falhas já estão no banco, porque a feature 002 grava `failed` com o erro.
- **Alternatives considered**:
  - Considerar só o erro "Connection Closed": as falhas de restrição chegam com outros textos e status, e contar todas é mais seguro.

## R12 — Tentativas de QR code

- **Decision**: O `createInstanceManager` guarda os horários dos últimos pedidos de QR. Acima de 5 em 10 min, `prepareQr` lança `TooManyAttempts` e a rota responde `429 { error: "too_many_attempts", retryAt }` (FR-029).
- **Rationale**: O ponto certo é onde o pedido nasce. O `pendingQr` atual já evita pedidos simultâneos; aqui o que se limita é a sequência.

## R13 — Conversas atendidas por dia

- **Decision**: O limite conta, numa janela móvel de 24 h, as conversas distintas com mensagem do assistente `sent`. Uma conversa que já foi atendida nessa janela continua sendo atendida, e só uma conversa **nova** passa do limite. A conversa barrada fica destacada (`flagNeedsAttention`) com o registro `system` "Limite diário de conversas atingido" (FR-011).
- **Rationale**: Cortar quem já está no meio de um agendamento seria pior para o cliente e não reduz o risco: o que pesa são destinatários diferentes. A janela móvel dispensa escolher um fuso para "dia".

## R14 — Onde fica o registro do que não saiu

- **Decision**:
  - **Status novo:** o enum `message_status` ganha o valor `blocked`. A resposta barrada é gravada como mensagem do assistente com `status = blocked` e `error` igual ao código do motivo. O painel a mostra como "Não enviada pela proteção: <motivo em português>" (FR-031).
  - **Logs:** registram o motivo e o id da conversa, nunca o texto.
  - **Contexto do modelo:** `recentTexts`, o contexto do `llama3`, passa a ignorar `blocked`.
- **Rationale**: O operador já lê o histórico. Ali é onde ele procura o motivo de o assistente não ter respondido.
- **Alternatives considered**:
  - Uma tabela de auditoria separada: mais uma tela para o operador procurar.
  - Só log: invisível no painel.

## R15 — Configuração

- **Decision**: Todos os limites viram variáveis `ANTIBAN_*` em `src/config/env.ts`, validadas com zod e com os padrões da spec. A lista completa está em [data-model.md](data-model.md#configuração) (FR-030).
- **Rationale**: É o padrão do projeto (features 001 a 003).
