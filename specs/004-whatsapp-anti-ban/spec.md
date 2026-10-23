# Feature Specification: Proteção do número contra banimento (anti-ban)

**Feature Branch**: `004-whatsapp-anti-ban`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Quero que você faça uma pesquisa de todo comportamento que pode levar ao banimento de um número no WhatsApp nesse tipo de assistente. Faça uma lista e implemente no código como um "anti-ban"."

## Contexto

O Secretaryfy conecta o número da clínica ao WhatsApp por uma conexão não oficial (pareamento por QR code, como o WhatsApp Web), e não pela plataforma oficial da Meta. Os termos do WhatsApp proíbem mensagens automatizadas e em massa não autorizadas, e o WhatsApp detecta isso combinando sinais automáticos com denúncias de usuários. **Nenhuma proteção elimina o risco**: o único caminho sem esse risco é a plataforma oficial. O que esta feature faz é manter o comportamento do número parecido com o de uma recepção atenciosa, longe dos sinais que mais levam a restrições e banimentos.

O Secretaryfy já tem algumas proteções porque **só responde quem escreveu primeiro**: ignora grupos, status e listas de transmissão, e não dispara mensagens para listas. Falta controlar o ritmo, o volume, as repetições e os laços de conversa, e reagir quando algo der errado.

### Comportamentos que levam ao banimento (pesquisa)

Fontes: termos e central de ajuda do WhatsApp, guias de fornecedores de API (Whapi, Take, Darwin AI, checkleaked) e guias da comunidade brasileira (Hora de Codar). Os números vêm de fornecedores e da comunidade, não da Meta. São referências, não limites oficiais.

| # | Comportamento de risco | Situação no Secretaryfy | Tratado por |
|---|---|---|---|
| 1 | Mandar mensagem primeiro para quem nunca falou com o número (contato frio) | Não acontece pelo assistente; o operador pode escrever numa conversa antiga | FR-001, FR-002, FR-003 |
| 2 | Responder na hora, sem tempo de leitura e digitação (padrão de robô) | Acontece: o assistente responde assim que o modelo termina | FR-005 a FR-008 |
| 3 | Intervalos fixos entre mensagens | Acontece quando há várias respostas seguidas | FR-006, FR-010 |
| 4 | Rajadas: muitas mensagens por minuto ou muitos destinatários diferentes em pouco tempo | Possível com várias conversas ao mesmo tempo | FR-009 a FR-012 |
| 5 | Várias mensagens seguidas para a mesma pessoa sem resposta dela | Possível em erros e reenvios | FR-013 |
| 6 | Laço com outro robô (dois assistentes respondendo um ao outro) | Possível: nada impede hoje | FR-014, FR-015 |
| 7 | Texto idêntico repetido para a mesma pessoa ou para muitas | Acontece com mensagens fixas (ex.: "assistente indisponível") | FR-016, FR-017 |
| 8 | Links não pedidos, sobretudo na primeira mensagem | Possível se o modelo incluir um link | FR-018 |
| 9 | Não marcar como lida o que o cliente mandou | Acontece: as mensagens do cliente não são marcadas como lidas | FR-019 |
| 10 | Insistir com quem pediu para parar (gera bloqueio e denúncia) | Não há opção de sair | FR-020 a FR-022 |
| 11 | Número novo com volume alto logo de cara (sem aquecimento) | Possível ao conectar um número recém-criado | FR-023, FR-024 |
| 12 | Atividade contínua o dia inteiro, sem pausa | Possível em dias de muito movimento | FR-011 |
| 13 | Reenvios automáticos em sequência depois de falhas | O operador reenvia à mão, mas nada impede repetições rápidas | FR-025 |
| 14 | Bloqueios, denúncias e falhas de entrega em alta (o número já está sendo limitado) | Ninguém fica sabendo | FR-026 a FR-028 |
| 15 | Muitas tentativas seguidas de conectar ou gerar QR code | Em parte já evitado (um pedido de QR por vez) | FR-029 |
| 16 | Conteúdo proibido, enganoso ou com muitos termos financeiros | Baixo: respostas vêm do folheto da clínica | Fora do escopo (o folheto é revisado pela clínica) |
| 17 | Versão desatualizada ou adulterada do software de conexão | Versão fixada na configuração do projeto | Fora do escopo do código; ver Assumptions |
| 18 | Perfil sem foto, nome ou descrição | Depende da clínica | Fora do escopo do código; ver Assumptions |
| 19 | Número virtual ou recém-registrado pareado no mesmo dia | Depende da clínica | Fora do escopo do código; ver Assumptions |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O assistente responde no ritmo de uma pessoa (Priority: P1)

O cliente manda uma mensagem. Antes de responder, o assistente marca a mensagem como lida, mostra "digitando…" por um tempo proporcional ao tamanho da resposta, com variação, e só então envia. Quando há muitas conversas ao mesmo tempo, as respostas entram numa fila e saem espaçadas, sem rajada, mesmo que algumas demorem um pouco mais.

**Why this priority**: Responder em milissegundos, a intervalos fixos e em rajadas é o sinal de robô que acontece hoje em toda conversa. É a proteção que mais reduz o risco no uso normal.

**Independent Test**: Mandar mensagens de dois números de teste ao mesmo tempo e observar no celular do cliente: a mensagem fica lida, aparece "digitando…", a resposta chega depois de alguns segundos, e as respostas das duas conversas não saem no mesmo instante.

**Acceptance Scenarios**:

1. **Given** o assistente decidiu a resposta, **When** vai enviá-la, **Then** a mensagem do cliente já está marcada como lida e o cliente vê "digitando…" antes da resposta.
2. **Given** duas respostas de tamanhos diferentes, **When** são enviadas, **Then** a mais longa fica mais tempo em "digitando…", e duas respostas do mesmo tamanho não esperam exatamente o mesmo tempo.
3. **Given** dez conversas pedindo resposta ao mesmo tempo, **When** o assistente responde, **Then** o número nunca passa do limite de mensagens por minuto, e as que excederem esperam a vez sem se perder.
4. **Given** uma resposta esperando na fila, **When** o operador pausa o assistente naquela conversa, **Then** a resposta não é enviada.

---

### User Story 2 - O assistente nunca insiste nem entra em laço (Priority: P1)

O assistente responde a cada mensagem do cliente, mas não manda várias seguidas para quem não respondeu, não repete o mesmo texto e percebe quando está conversando com outro robô. Nesses casos, ele para de responder naquela conversa e a destaca para o operador.

**Why this priority**: Um laço com outro robô gera centenas de mensagens em minutos, e insistir com quem não responde gera bloqueios e denúncias, dois dos sinais mais fortes para o WhatsApp. Um único laço pode derrubar o número.

**Independent Test**: Simular um contato que responde automaticamente a cada mensagem e conferir que, depois do limite, o assistente para, a conversa fica destacada no painel e nenhuma mensagem nova sai para esse contato.

**Acceptance Scenarios**:

1. **Given** um contato que responde em menos de poucos segundos a cada mensagem do assistente, **When** a troca passa do limite de respostas rápidas seguidas, **Then** o assistente pausa a conversa, destaca para o operador e não envia mais nada.
2. **Given** o assistente já enviou o número máximo de mensagens seguidas sem resposta do cliente, **When** surge outra resposta para enviar, **Then** ela não é enviada.
3. **Given** o assistente enviou um texto para um cliente, **When** a próxima resposta para o mesmo cliente seria idêntica e próxima no tempo, **Then** ela não é enviada repetida (é trocada por uma variação ou descartada, conforme o caso).

---

### User Story 3 - O cliente pode pedir para parar (Priority: P1)

O cliente manda "parar", "sair", "stop" ou equivalente. O assistente confirma uma única vez que não vai mais mandar mensagens, e a partir daí não responde mais aquele número, até o cliente voltar a falar por conta própria com outro pedido claro.

**Why this priority**: Quem pediu para parar e continua recebendo mensagens bloqueia e denuncia. Respeitar o pedido também é uma exigência das políticas do WhatsApp e da LGPD.

**Independent Test**: Mandar "stop" de um número de teste, conferir a confirmação única, mandar outra mensagem qualquer e conferir que o assistente não responde e que o painel mostra a conversa como "não quer receber mensagens".

**Acceptance Scenarios**:

1. **Given** uma conversa ativa, **When** o cliente manda uma palavra de saída, **Then** o assistente responde uma única confirmação e passa a não responder esse número.
2. **Given** um número que pediu para sair, **When** o cliente manda uma mensagem comum, **Then** o assistente não responde, e a mensagem continua aparecendo no painel para o operador.
3. **Given** um número que pediu para sair, **When** o cliente manda uma palavra de retorno ("voltar", "start"), **Then** o assistente volta a responder.

---

### User Story 4 - O operador não escreve para contato frio sem perceber (Priority: P2)

O operador abre uma conversa em que o cliente não escreve há mais de 24 horas e tenta enviar uma mensagem. O painel avisa que mandar mensagem para quem não falou recentemente aumenta o risco de banimento e pede confirmação. O assistente nunca envia nada fora dessa janela.

**Why this priority**: É a única forma de o Secretaryfy iniciar uma conversa hoje. É rara, mas cada mensagem para contato frio pesa muito.

**Independent Test**: Numa conversa cuja última mensagem do cliente tem mais de 24 horas, tentar enviar pelo painel e conferir o aviso e a necessidade de confirmar; numa conversa recente, conferir que o envio segue direto.

**Acceptance Scenarios**:

1. **Given** a última mensagem do cliente tem mais de 24 horas, **When** o operador tenta enviar, **Then** o painel avisa do risco e só envia se ele confirmar.
2. **Given** a última mensagem do cliente tem menos de 24 horas, **When** o operador envia, **Then** não há aviso.
3. **Given** um cliente que pediu para sair, **When** o operador tenta enviar, **Then** o painel avisa que o cliente pediu para não receber mensagens e só envia se ele confirmar.

---

### User Story 5 - O sistema freia sozinho quando o número dá sinais de restrição e avisa o operador (Priority: P2)

Quando as falhas de envio se acumulam (mensagens que não saem, número limitado, conexão caindo seguidas vezes), o Secretaryfy pausa os envios automáticos por um tempo e mostra no painel um aviso com o motivo. O operador vê o estado da proteção e quando os envios voltam.

**Why this priority**: Continuar enviando quando o número já está sendo limitado é o caminho mais curto de uma restrição temporária para um banimento definitivo.

**Independent Test**: Simular uma sequência de falhas de envio e conferir que os envios automáticos param, que o painel mostra o aviso e o horário de retomada, e que eles voltam sozinhos depois do tempo de espera.

**Acceptance Scenarios**:

1. **Given** várias falhas de envio em pouco tempo, **When** passa do limite, **Then** os envios automáticos param, as respostas pendentes não são enviadas e o painel mostra o aviso.
2. **Given** os envios automáticos estão pausados pela proteção, **When** termina o tempo de espera, **Then** eles voltam sozinhos e o aviso some do painel.
3. **Given** os envios automáticos estão pausados pela proteção, **When** o operador tenta enviar pelo painel, **Then** ele é avisado de que o número está em risco e precisa confirmar.

---

### User Story 6 - Número novo começa devagar (aquecimento) (Priority: P3)

Quando a clínica conecta um número que o Secretaryfy nunca usou, ele entra em modo de aquecimento por alguns dias: os limites de mensagens e de conversas novas por dia são menores e sobem aos poucos. O painel mostra que o número está em aquecimento e até quando.

**Why this priority**: Número novo com volume alto é um sinal forte, mas só vale nos primeiros dias de uso, e o volume do Secretaryfy depende dos clientes que escrevem.

**Independent Test**: Conectar um número novo, conferir no painel o aviso de aquecimento e que o limite diário de conversas atendidas é o reduzido; ao passar do limite, conferir que as conversas excedentes ficam destacadas para o operador em vez de respondidas.

**Acceptance Scenarios**:

1. **Given** um número conectado pela primeira vez, **When** o painel abre, **Then** mostra que o número está em aquecimento e até quando.
2. **Given** o número em aquecimento atingiu o limite de conversas atendidas no dia, **When** um cliente novo escreve, **Then** o assistente não responde e a conversa fica destacada para o operador.
3. **Given** o período de aquecimento acabou, **When** os clientes escrevem, **Then** valem os limites normais.

### Edge Cases

- O cliente manda várias mensagens curtas seguidas ("oi", "tudo bem?", "queria marcar"): o assistente espera alguns segundos de silêncio e responde uma vez, não uma vez para cada mensagem.
- A conexão cai enquanto há respostas na fila: elas não são enviadas em rajada quando a conexão volta; as que ficaram velhas demais são descartadas e a conversa fica destacada para o operador.
- O servidor reinicia com respostas na fila: elas não são reenviadas em sequência na volta.
- O operador envia pelo painel enquanto o assistente tem uma resposta na fila da mesma conversa: a do assistente é descartada (o envio do operador já pausa o assistente).
- A palavra de saída aparece no meio de uma frase ("não quero parar o tratamento"): só conta como pedido de saída a mensagem que é a própria palavra, ou uma frase curta e clara de saída.
- O cliente que pediu para sair volta pelo link de agendamento ou com uma pergunta normal: não volta sozinho; só volta com uma palavra de retorno ou quando o operador reativar.
- A mensagem fixa de indisponibilidade do assistente seria enviada várias vezes para o mesmo cliente: sai no máximo uma vez num intervalo de tempo.
- O próprio número da clínica (mensagens para si mesmo): continua ignorado pelo assistente.
- Os limites são atingidos por mensagens do operador: elas também contam nos limites por minuto e por dia, mas o operador nunca é bloqueado sem aviso; ele recebe o aviso e decide.

## Requirements *(mandatory)*

### Functional Requirements

**Quem pode receber mensagens**

- **FR-001**: O assistente MUST enviar mensagens só em resposta a um cliente, dentro de 24 horas da última mensagem desse cliente, e nunca iniciar uma conversa.
- **FR-002**: O painel MUST avisar o operador e pedir confirmação antes de enviar numa conversa em que a última mensagem do cliente tem mais de 24 horas, ou em que o cliente nunca escreveu.
- **FR-003**: O sistema MUST continuar ignorando grupos, status, listas de transmissão e mensagens do próprio número.
- **FR-004**: O sistema MUST NOT oferecer envio em massa, para listas ou para números que não têm conversa.

**Ritmo de resposta**

- **FR-005**: Antes de responder, o assistente MUST marcar como lidas as mensagens do cliente na conversa.
- **FR-005a**: O assistente MUST NOT visualizar as mensagens assim que elas chegam: a marcação de lida MUST acontecer depois de um tempo aleatório contado da última mensagem do cliente (padrão: entre 2 e 8 segundos), descontado o tempo que já passou até a resposta ficar pronta.
- **FR-005b**: Depois de visualizar, o assistente MUST esperar antes de começar a digitar, por um tempo que cresce com o tamanho da mensagem do cliente e varia a cada vez (padrão: entre 1 e 3 segundos).
- **FR-006**: Antes de cada resposta, o assistente MUST mostrar "digitando…" por um tempo proporcional ao tamanho do texto, com variação aleatória, dentro de um mínimo e um máximo (padrão: entre 2 e 12 segundos).
- **FR-007**: Quando o cliente manda várias mensagens seguidas, o assistente MUST esperar um intervalo de silêncio (padrão: 4 segundos) e responder ao conjunto uma única vez.
- **FR-008**: O tempo de digitação MUST NOT ser fixo: duas respostas iguais em tamanho MUST ter esperas diferentes.

**Volume**

- **FR-009**: O sistema MUST limitar as mensagens enviadas pelo número por minuto (padrão: 8) e por hora (padrão: 200), somando assistente e operador.
- **FR-010**: As respostas que passarem do limite MUST esperar numa fila e sair espaçadas, com intervalos variáveis entre si, nunca em rajada.
- **FR-011**: O sistema MUST limitar as conversas diferentes atendidas pelo assistente por dia (padrão: 150; no aquecimento, ver FR-024). Acima do limite, o assistente não responde e a conversa fica destacada para o operador.
- **FR-012**: Uma resposta que ficar na fila mais do que um tempo máximo (padrão: 5 minutos) MUST ser descartada, e a conversa destacada para o operador.

**Insistência, laços e repetição**

- **FR-013**: O assistente MUST NOT enviar mais do que um número de mensagens seguidas para um cliente sem resposta dele (padrão: 3).
- **FR-014**: O sistema MUST detectar laço com outro robô: quando o contato responde muito rápido (padrão: menos de 3 segundos) a várias mensagens seguidas do assistente (padrão: 5 vezes), ou quando a conversa passa de um número de mensagens do assistente num curto período (padrão: 20 em 10 minutos).
- **FR-015**: Ao detectar um laço, o sistema MUST pausar o assistente naquela conversa e destacá-la para o operador com o motivo, sem enviar aviso ao contato.
- **FR-016**: O assistente MUST NOT enviar para o mesmo cliente um texto idêntico a outro enviado a ele num período recente (padrão: 30 minutos).
- **FR-017**: Mensagens fixas do sistema (ex.: "assistente indisponível") MUST ter variações de texto e sair no máximo uma vez por cliente num período (padrão: 30 minutos).
- **FR-018**: O assistente MUST NOT enviar links na sua primeira resposta a um cliente, e MUST NOT enviar links que o cliente não tenha pedido ou que não sejam do domínio da clínica; um link barrado é retirado do texto e o envio segue sem ele.

**Pedido de saída**

- **FR-019**: O sistema MUST reconhecer pedidos de saída (palavras como "parar", "sair", "stop", "cancelar mensagens", em português e inglês) quando são a mensagem inteira ou uma frase curta e clara de saída.
- **FR-020**: Ao reconhecer um pedido de saída, o assistente MUST enviar uma única confirmação e, a partir daí, MUST NOT responder aquele número.
- **FR-021**: O cliente MUST poder voltar com uma palavra de retorno ("voltar", "start"), e o operador MUST poder reativar pelo painel.
- **FR-022**: O painel MUST mostrar que o cliente pediu para não receber mensagens.

**Aquecimento**

- **FR-023**: Ao conectar um número que o Secretaryfy nunca usou, o sistema MUST entrar em modo de aquecimento por um período (padrão: 14 dias), mostrado no painel com a data de término.
- **FR-024**: No aquecimento, os limites de FR-009 e FR-011 MUST ser menores e subir aos poucos (padrão: começar com 30 conversas por dia e 4 mensagens por minuto, chegando aos limites normais no fim do período).

**Falhas e freio automático**

- **FR-025**: O sistema MUST NOT reenviar automaticamente uma mensagem que falhou; o reenvio pelo operador MUST respeitar um intervalo mínimo entre tentativas da mesma mensagem (padrão: 30 segundos).
- **FR-026**: O sistema MUST pausar os envios automáticos por um tempo (padrão: 30 minutos) quando as falhas de envio passarem de um limite num período (padrão: 5 falhas em 10 minutos), ou quando a conexão cair mais de um número de vezes num período (padrão: 3 vezes em 30 minutos).
- **FR-027**: Durante o freio, as respostas pendentes MUST NOT ser enviadas, as conversas afetadas MUST ficar destacadas, e o operador MUST ser avisado ao tentar enviar e precisar confirmar.
- **FR-028**: O painel MUST mostrar o estado da proteção: normal, em aquecimento (até quando) ou freio ativo (motivo e horário de retomada).
- **FR-029**: O sistema MUST limitar as tentativas de conectar ou gerar QR code (padrão: 5 por 10 minutos) e avisar o operador quando passar do limite.

**Configuração e registro**

- **FR-030**: Todos os limites MUST ter os valores padrão acima e poder ser ajustados pela configuração do servidor, sem mudar o código.
- **FR-031**: Cada mensagem não enviada pela proteção MUST ficar registrada com o motivo (limite, laço, repetição, saída, freio, fila velha), visível ao operador, sem dados pessoais nos logs.

### Key Entities

- **Limite de envio**: as contagens recentes de mensagens enviadas pelo número (por minuto, por hora) e de conversas atendidas no dia, que decidem se uma resposta sai agora, espera ou não sai.
- **Resposta na fila**: uma resposta decidida pelo assistente que espera a vez; tem a conversa, o texto, quando foi decidida e até quando ainda vale.
- **Estado da proteção**: normal, aquecimento (com início e fim) ou freio (com motivo e horário de retomada); um por número conectado.
- **Preferência do cliente**: se o número pediu para não receber mensagens, e quando.
- **Bloqueio de envio**: o registro de uma resposta que a proteção não enviou, com o motivo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das respostas do assistente são precedidas pela marcação de lida e por "digitando…", e nenhuma resposta sai em menos de 2 segundos depois da última mensagem do cliente.
- **SC-002**: Com 20 clientes escrevendo ao mesmo tempo, o número nunca passa do limite de mensagens por minuto, e todas as respostas dentro do tempo máximo de fila chegam aos clientes.
- **SC-003**: Uma simulação de laço com outro robô é interrompida em no máximo 10 mensagens do assistente.
- **SC-004**: Depois de um pedido de saída, o número recebe exatamente uma mensagem (a confirmação) e mais nenhuma do assistente.
- **SC-005**: Nenhuma mensagem do assistente é enviada para um número cuja última mensagem tem mais de 24 horas.
- **SC-006**: Depois de 5 falhas de envio seguidas, nenhum envio automático sai até o fim do tempo de espera, e o operador vê o aviso no painel em até 5 segundos.
- **SC-007**: Em uso normal (um cliente por vez), o tempo entre a mensagem do cliente e a resposta cresce no máximo 15 segundos em relação a hoje.

## Assumptions

- **A proteção reduz o risco, não o elimina.** A conexão não oficial continua contrária aos termos do WhatsApp. Se a clínica precisar de garantia, o caminho é migrar para a plataforma oficial da Meta, o que fica fora desta feature.
- Os valores padrão vêm de guias de fornecedores e da comunidade, não da Meta (que não publica limites para a conexão não oficial). Eles são conservadores para o volume de uma clínica e ajustáveis (FR-030).
- O Secretaryfy não tem como saber diretamente quando um cliente bloqueia ou denuncia o número. A proteção usa os sinais disponíveis: falhas de envio, quedas de conexão e o comportamento das conversas.
- O volume esperado é o de uma clínica: dezenas de conversas por dia, não milhares. A fila e os limites são pensados para isso.
- "Número que o Secretaryfy nunca usou" é um número cuja conexão não foi registrada antes neste Secretaryfy. Não há como saber a idade real do número no WhatsApp; a clínica pode encerrar o aquecimento mais cedo pela configuração.
- Ficam fora do código e entram como recomendação no quickstart: manter o software de conexão atualizado e de fonte oficial; ter foto, nome e descrição no perfil; não usar número virtual; esperar ao menos um dia entre registrar o número e pareá-lo; pedir aos clientes que salvem o número; divulgar o número com link de conversa (wa.me) para que o cliente escreva primeiro.
- O pedido de saída é reconhecido por palavras e frases fixas, sem depender do modelo de IA, para funcionar mesmo com o assistente fora do ar.
- As respostas continuam em inglês como hoje (folheto da DentalSafe); a confirmação de saída segue o idioma das respostas, e as palavras de saída são reconhecidas em português e em inglês.
