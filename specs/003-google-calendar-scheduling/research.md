# Research: Agendamento pelo Google Agenda

Decisões técnicas da Fase 0, consolidadas para o [plan.md](plan.md).

## R1. Como o modelo local conduz o agendamento

**Decision**: O agendamento é uma **máquina de estados determinística** em Node (`src/modules/scheduling/`). O modelo local só **interpreta** a mensagem do cliente e devolve um JSON validado. Quem decide o próximo passo, consulta a agenda, cria o evento e escreve o texto da resposta é o código.

1. **Atalhos sem modelo**: resposta só com um número (`^\s*\d{1,2}\s*$`) é a escolha de uma opção; `yes/yeah/ok/confirm` e `no/cancel that/nope` numa etapa de confirmação são sim e não; datas simples (`today`, `tomorrow`, nomes dos dias, `next <dia>`, `20/10`, `Oct 20`) passam por um parser próprio.
2. **Modelo para o resto**: o Ollama recebe a mensagem, a etapa atual, as opções oferecidas, a data de hoje com o dia da semana e o fuso, e as últimas mensagens da conversa. Ele responde no formato `{ intent, option, date, name }` (ver [contracts/interpreter.md](contracts/interpreter.md)), forçado com o parâmetro `format` (JSON Schema) da `/api/chat` e `temperature: 0`.
3. **Validação**: a saída passa por zod. Uma data fora da janela permitida, uma opção que não existe ou um JSON inválido contam como "não entendi" (FR-024a).
4. **Textos fixos**: as mensagens ao cliente vêm de modelos de texto em inglês no código, preenchidos com dados da agenda. O modelo nunca escreve "booked": só o código depois de o evento existir (FR-024).

**Rationale**: A spec exige modelo local (FR-025). O `llama3` 8B instalado não tem suporte a ferramentas no Ollama e erra datas relativas, mas classifica bem a intenção quando a saída é restrita por schema. Com a máquina de estados, os critérios SC-002 a SC-004 (horários certos, sem duplicidade, sem marcar sem confirmação) passam a depender do código, que é testável, e não do modelo. As opções numeradas (Clarifications, Q1) reduzem o trabalho do modelo à maior parte das respostas.

**Alternatives considered**:
- *Agente com tool calling* (o modelo decide quando chamar `freeBusy` e `insertEvent`): exige um modelo com suporte a ferramentas, e erros do modelo virariam erros de agenda. Fica para quando houver um modelo local melhor medido.
- *Gerar as respostas com o modelo*: textos mais naturais, mas sem garantia de nunca afirmar algo falso (FR-024) e mais lentos.
- *Só regras, sem modelo*: não entende frases como "can I come in sometime next week?" ou "I need to change my appointment".

## R2. Modelo e chamada ao Ollama

**Decision**: O Node chama o Ollama direto em `POST {OLLAMA_URL}/api/chat` com `stream: false`, `format: <JSON Schema>`, `options: { temperature: 0 }` e `keep_alive: "30m"`. Variáveis novas: `OLLAMA_URL` (padrão `http://127.0.0.1:11434`), `AGENT_MODEL` (padrão `llama3`, o modelo já instalado) e `AGENT_TIMEOUT_MS` (padrão `20000`).

**Verificado em 2026-10-18 (T003)**: o `llama3` obedece ao `format` (o JSON sempre veio no schema). Com o modelo carregado, cada chamada levou ~1 s; a primeira, com o carregamento, ~19 s. Com uma instrução mínima, porém, ele classificou "Can I come in next Friday?" como `stop` e devolveu a quinta-feira como data. Isso reforça as decisões de R1: datas e números resolvidos por regras no código, e o modelo com instruções detalhadas e exemplos de cada intenção.

**Avaliação em 2026-10-18 (T061, `scripts/eval-scheduling.ts`, 20 cenários, `llama3`)**: a primeira rodada acertou 18/20. As duas falhas eram do modelo: "the 10 am one" virou uma data em vez da opção, e "openings on Sunday?" virou sábado. Duas regras novas no código resolveram as duas (contracts/interpreter.md): horário citado ("10 am", "2:30 pm", "14:00") escolhe a opção oferecida, e uma data simples citada no meio da frase substitui a data do modelo. Resultado final: **20/20 (SC-005)**, 0 horários fora da regra (SC-002), 0 sobreposições (SC-003), 0 mudanças sem confirmação (SC-004) e latência p95 de 0,9 s, máxima de 1,1 s, com o modelo já carregado (SC-008).

**Rationale**: É a mesma instância do Ollama que o `rag/` usa (versão 0.40.5 na máquina, que aceita `format` com schema). Chamar direto evita mudar o serviço Python, cujo comportamento a feature 001 mantém congelado. O `keep_alive` evita recarregar o modelo a cada mensagem (SC-008).

**Alternatives considered**:
- *Novo endpoint no `rag/server.py`*: mexeria no serviço avaliado da feature 001 sem ganho.
- *Trocar de modelo agora* (`llama3.1:8b`, `qwen2.5:7b`): podem interpretar melhor, mas a troca deve ser medida. O script de avaliação (R12) recebe `AGENT_MODEL` e permite comparar modelos antes de mudar o padrão.

## R3. Quando a mensagem vai para o agendamento ou para o folheto

**Decision**: Toda mensagem de texto do cliente passa pelo `scheduling/router`:

| Situação | Caminho |
|---|---|
| Conversa numa etapa do agendamento (oferta de dias, horários, nome ou confirmação) | Interpretação na etapa. Se a intenção for `question`, a resposta vem do RAG e a etapa continua (FR-021) |
| Conversa sem etapa e intenção `book`, `availability`, `cancel`, `reschedule` ou `my_appointment` | Inicia o fluxo correspondente |
| Conversa sem etapa e intenção `question` ou `other` | RAG, como na feature 001 |
| Ollama fora do ar ou estourou o tempo | Sem etapa: RAG. Com etapa: mensagem de indisponibilidade e a etapa é mantida |

**Rationale**: Mantém o comportamento da feature 001 para dúvidas e só acrescenta uma classificação antes. Quem só pergunta sobre preços continua recebendo a mesma resposta.

## R4. Estado da conversa de agendamento

**Decision**: Tabela `scheduling_sessions`, uma linha por conversa no máximo, com a etapa, as opções numeradas oferecidas (JSON), o horário escolhido, o nome, o contador de "não entendi" e `expires_at`. Ver [data-model.md](data-model.md). A sessão expira 30 minutos depois da última interação: ao voltar, o cliente recomeça do pedido de dia, e a disponibilidade é lida de novo antes de qualquer confirmação (Edge Case "cliente some").

**Rationale**: Guardar no Postgres faz o fluxo sobreviver a reinícios do `tsx watch`. Guardar as opções oferecidas é o que permite entender "2".

**Alternatives considered**: estado em memória, que se perde a cada reinício; reconstruir o estado relendo o histórico, que é frágil.

## R5. Contexto da conversa para o modelo

**Decision**: O interpretador recebe as últimas 20 mensagens de texto da conversa (Assumptions), lidas da tabela `messages` da feature 002, como `customer` → `user` e `assistant/operator/phone` → `assistant`. As respostas do RAG continuam sem histórico, como na feature 001.

**Rationale**: O histórico já está gravado, e 20 mensagens cabem com folga no contexto do `llama3`.

## R6. Cálculo dos horários livres

**Decision**: Função pura `availableSlots(rules, busy, now, from, to)` em `src/modules/scheduling/availability.ts`, com datas do **Luxon** (`luxon@3.7.2`, `@types/luxon@3.7.1`):

1. Para cada dia entre `from` e `to` (limite: `max_days_ahead`), no fuso da agenda, se o dia da semana tem atendimento, gera horários de `start` a `end - duração` em passos da duração (FR-009).
2. Remove os que começam antes de `now + min_notice` (Edge Case "horário no passado").
3. Remove os que se sobrepõem a algum intervalo ocupado (`busy[i].start < slot.end && busy[i].end > slot.start`).

Os intervalos ocupados vêm do `freebusy.query` (R8), que já ignora eventos marcados como "disponível" (Assumptions) e expande eventos de dia inteiro e recorrentes.

**Rationale**: Uma função pura cobre as regras de FR-009/FR-010 com testes de unidade simples, sem rede. O Luxon trata fuso e horário de verão com segurança. O Node 24 ainda não tem `Temporal` sem flag, e fazer conversão de fuso à mão com `Intl` é fácil de errar.

**Alternatives considered**: `date-fns-tz` (API mais trabalhosa para "dia X às 9h no fuso Y"); `@js-temporal/polyfill` (ainda pesado e instável).

## R7. Conexão com o Google: uma agenda da clínica

**Decision**:
- A tabela `calendar_connection` (uma linha só) substitui `google_accounts` e `users`, que nunca foram usadas e ligavam a conta Google a um cliente. A migration remove as duas.
- Escopos: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly` e `https://www.googleapis.com/auth/calendar.events.freebusy`. Sai o `gmail.send`, que nenhuma feature usa.
- Fluxo: o painel chama `POST /api/calendar/connect`, que devolve a URL de consentimento com `access_type=offline`, `prompt=consent` e `state = sign("calendar-connect", 600)`. O Google volta para `GET /auth/google/callback`, já existente, que valida o `state`, troca o `code`, grava o refresh token criptografado com o `crypto.ts`, escolhe a agenda principal da conta como padrão e redireciona para `${PANEL_URL}/#/agenda`.
- A rota de retorno não depende do cookie do painel: ele é `SameSite=Strict` e não acompanha a volta do Google. A proteção é o `state` assinado, que só sai de uma rota autenticada e expira em 10 minutos.
- Nova variável `PANEL_URL` (opcional, padrão `PUBLIC_URL`), porque em desenvolvimento o painel roda no Vite (`:5173`).
- Desconectar: `POST https://oauth2.googleapis.com/revoke` com o refresh token, e a linha é apagada (FR-004).

**Rationale**: A spec define uma agenda da instalação, conectada pelo operador (Assumptions). Os escopos são os mais estreitos que cobrem listar agendas, ler ocupação e criar, alterar e apagar eventos, seguindo a recomendação do Google ([Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)).

## R8. Chamadas ao Google Agenda

**Decision**: Usar o pacote `googleapis@186.0.0`, já instalado, isolado em `src/modules/google/calendar.ts` atrás de uma interface `CalendarGateway`, para os testes usarem uma agenda falsa. As chamadas estão em [contracts/google-calendar.md](contracts/google-calendar.md):

| Necessidade | Chamada |
|---|---|
| Listar agendas e fuso (FR-002) | `calendarList.list` |
| Ocupação (FR-010, FR-012) | `freebusy.query` na agenda escolhida, sem cache |
| Marcar (FR-016) | `events.insert` com `extendedProperties.private.secretaryfy_appointment = <id>` |
| Conferir antes de usar (FR-018a) | `events.get`: `status = cancelled` ou 404/410 contam como apagado, e `start` diferente conta como movido |
| Cancelar | `events.delete` |
| Remarcar | `events.patch` com o novo `start`/`end` |

**Erros**: `invalid_grant` ao renovar o token marca a conexão como `needs_reauth` e avisa o painel (US3, cenário 6). Erros 5xx e timeouts (10 s) viram `CalendarUnavailable` e a mensagem "can't book right now" (FR-022).

## R9. Evitar marcar o mesmo horário duas vezes

**Decision**: Duas barreiras (FR-015, SC-003):
1. **Trava no processo**: toda criação ou mudança de evento passa por uma fila única (`withCalendarLock`), já que há um processo só. Dentro dela, o `freebusy.query` é refeito para o horário escolhido logo antes do `events.insert`.
2. **Banco**: índice único parcial em `appointments (starts_at) where status = 'booked'`. Ele barra uma segunda gravação mesmo que a trava falhe.

A regra de um horário futuro por número (FR-019) é verificada dentro da mesma trava: busca o agendamento `booked` futuro da conversa e confere o evento no Google (FR-018a) antes de decidir.

**Alternatives considered**: lock no Postgres (`pg_advisory_xact_lock`), desnecessário com um processo só, mas é o caminho se o Secretaryfy passar a rodar em mais de uma instância.

## R10. Registro no histórico e "precisa de atendimento"

**Decision**:
- O enum `message_origin` ganha o valor `system`. Ao marcar, cancelar ou remarcar, o inbox grava uma mensagem `system` (não enviada ao WhatsApp, `status = received`) com o texto "📅 Agendado: ter, 21/10 às 10:00" (ou "Cancelado"/"Remarcado") e publica `message.created` (FR-018, US4).
- `conversations` ganha `needs_attention boolean`. A desistência por "não entendi" (FR-024a) pausa o assistente e marca `needs_attention = true`. Abrir a conversa (`POST /read`) ou reativar o assistente limpa a marca (FR-024b). O `ConversationJson` ganha `needsAttention`.

**Rationale**: Reaproveita o histórico e o SSE da feature 002 sem tela nova para o operador acompanhar o que o assistente fez.

## R11. Regras de atendimento

**Decision**: Tabela `scheduling_rules` com uma linha só, criada com os padrões da spec na primeira leitura: segunda a sexta das 09:00 às 18:00, 60 min, antecedência de 120 min, 30 dias à frente, cancelamento até 1440 min antes. Os horários por dia ficam numa coluna JSON `weekly_hours` (`{ "1": { "start": "09:00", "end": "18:00" }, ... }`, de 1 = segunda a 7 = domingo, padrão ISO do Luxon). A validação (início antes do fim, duração entre 15 e 240 min, etc.) usa zod e fica em [contracts/panel-api.md](contracts/panel-api.md).

**Rationale**: Uma linha com JSON é o suficiente para um formulário só; normalizar em tabela por dia não traria ganho nesta fase.

## R12. Como medir SC-002 a SC-005 sem outro número

**Decision**:
- **Testes de unidade** (`node:test`, sem rede): `availability`, o parser de datas e números, a máquina de estados com interpretador e agenda falsos, a trava e o índice único.
- **Avaliação com o modelo real**: `scripts/eval-scheduling.ts` roda 20 conversas roteirizadas (`scripts/fixtures/scheduling-scenarios.json`) contra o Ollama de verdade e uma agenda falsa em memória. Ele mede o acerto de dia e hora (SC-005), os horários oferecidos fora da regra (SC-002), os eventos sem confirmação (SC-004) e o tempo por resposta (SC-008). `AGENT_MODEL` permite comparar modelos.
- **Ponta a ponta**: `scripts/simulate-customer.ts` manda ao webhook mensagens de cliente com o número do próprio operador (`fromMe: false`). A resposta chega no chat "Você" do WhatsApp e o evento aparece no Google Agenda real. É o roteiro do [quickstart.md](quickstart.md), que resolve a falta de um segundo número.
