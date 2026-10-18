# Feature Specification: Agendamento pelo Google Agenda

**Feature Branch**: `003-google-calendar-scheduling`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Integre a conexão com o Google Agenda/calendar e permita ao agente fazer agendamentos com base no que o cliente marca de horario; O agente também deverá ler a agenda para saber quais horários estão disponíveis para fornecer para o cliente e quais dias estão disponíveis também."

## Contexto

Hoje o assistente da DentalSafe responde no WhatsApp as dúvidas sobre a clínica a partir do folheto (feature 001), e o operador acompanha as conversas pelo painel web (feature 002). O assistente convida o cliente a agendar uma avaliação, mas não consegue marcar nada: cada mensagem é respondida isoladamente, sem lembrar do que foi dito antes, e o Secretaryfy não tem acesso a nenhuma agenda.

Esta feature liga o Secretaryfy ao Google Agenda da clínica. O **operador** conecta a agenda pelo painel e define as regras de atendimento. O **assistente** passa a consultar essa agenda para dizer ao **cliente** quais dias e horários estão livres, e marca o horário que o cliente escolher, tudo pela conversa do WhatsApp.

## Clarifications

### Session 2026-10-18

- Q: Como o cliente deve escolher dia e horário: pela conversa livre ou respondendo a uma lista numerada que o assistente oferece? → A: Híbrido: o assistente sempre oferece opções numeradas e aceita o número como resposta, e também entende pedidos simples de data em texto ("tomorrow", "Friday").
- Q: Um mesmo cliente (mesmo número de WhatsApp) pode ter mais de um horário futuro marcado ao mesmo tempo? → A: Não. Só um horário futuro por número; se o cliente pedir outro, o assistente oferece remarcar o existente.
- Q: Até quando o cliente pode cancelar ou remarcar sozinho pelo WhatsApp, antes do horário marcado? → A: Prazo configurável pelo operador no painel, com padrão de 24 horas antes; dentro do prazo, o assistente orienta o cliente a falar com a clínica.
- Q: Se o operador apagar ou mudar de horário, direto no Google Agenda, um evento marcado pelo assistente, o que o Secretaryfy deve considerar? → A: A agenda é a fonte da verdade. Antes de usar um agendamento, o evento é conferido no Google: apagado conta como cancelado, movido passa a valer no horário novo.
- Q: Quando o assistente não conseguir entender o cliente no agendamento, o que deve acontecer? → A: Depois de 2 tentativas seguidas sem entender, o assistente avisa o cliente que alguém da clínica vai continuar o atendimento, pausa o assistente nessa conversa e a conversa fica destacada no painel.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cliente marca um horário pelo WhatsApp (Priority: P1)

O cliente diz no WhatsApp que quer marcar uma avaliação. O assistente pergunta a preferência de dia (ou oferece os próximos dias com vaga), mostra os horários livres do dia escolhido e, quando o cliente escolhe um, repete o resumo (dia, horário e nome) e pede confirmação. Com o "sim" do cliente, o horário é marcado na agenda da clínica e o assistente confirma a marcação na conversa.

**Why this priority**: É o pedido central da feature e o motivo de o assistente convidar para agendamento. Sem marcar, ler a agenda não tem uso para o cliente.

**Independent Test**: Com a agenda conectada e algumas regras de atendimento definidas, conversar pelo WhatsApp de teste pedindo uma avaliação, escolher um horário oferecido, confirmar e conferir que o evento aparece no Google Agenda da clínica no horário certo.

**Acceptance Scenarios**:

1. **Given** a agenda conectada e o cliente sem horário marcado, **When** o cliente manda "I'd like to book an appointment", **Then** o assistente oferece dias com horários livres ou pergunta a preferência de dia.
2. **Given** o assistente ofereceu horários, **When** o cliente escolhe um deles, **Then** o assistente mostra o resumo (dia, horário, nome do cliente) e pede confirmação antes de marcar.
3. **Given** o resumo mostrado, **When** o cliente confirma, **Then** o evento é criado na agenda da clínica nesse horário, com o nome e o número de WhatsApp do cliente, e o assistente confirma a marcação ao cliente.
4. **Given** o resumo mostrado, **When** o cliente desiste ou pede outro horário, **Then** nada é criado na agenda e o assistente volta a oferecer opções.
5. **Given** o cliente escolheu um horário, **When** esse horário foi ocupado por outro evento antes da confirmação, **Then** nada é marcado em duplicidade: o assistente avisa que o horário acabou de ser preenchido e oferece os mais próximos.
6. **Given** o assistente ofereceu horários numerados, **When** o cliente responde só "2", **Then** o assistente entende que ele escolheu a segunda opção e segue para o resumo.
7. **Given** a conversa no meio de um agendamento, **When** o cliente responde "tomorrow" ou "Friday", **Then** o assistente oferece as opções numeradas desse dia.

---

### User Story 2 - Cliente pergunta dias e horários livres (Priority: P1)

O cliente pergunta quando há vaga ("Do you have anything on Thursday?", "What days are available next week?"). O assistente consulta a agenda e responde com os dias e horários livres, dentro das regras de atendimento da clínica, sem marcar nada até o cliente pedir.

**Why this priority**: Foi pedido explicitamente e é a base do agendamento: o cliente só escolhe bem se souber o que está livre. Também tem valor sozinho, para quem só quer saber se há vaga.

**Independent Test**: Com a agenda conectada, ocupar alguns horários de um dia no Google Agenda, perguntar pelo WhatsApp os horários desse dia e conferir que o assistente lista só os livres.

**Acceptance Scenarios**:

1. **Given** um dia de atendimento com alguns horários ocupados na agenda, **When** o cliente pergunta os horários desse dia, **Then** o assistente lista só os horários livres, dentro do horário de atendimento.
2. **Given** a agenda conectada, **When** o cliente pergunta quais dias estão disponíveis, **Then** o assistente responde com os próximos dias de atendimento que ainda têm pelo menos um horário livre.
3. **Given** um dia sem atendimento (por exemplo, domingo) ou totalmente ocupado, **When** o cliente pede esse dia, **Then** o assistente diz que não há vaga nesse dia e oferece os dias livres mais próximos.
4. **Given** uma pergunta sobre a clínica sem relação com horários (ex.: "How much are braces?"), **When** o cliente pergunta, **Then** o assistente continua respondendo pelo folheto, como na feature 001.
5. **Given** um evento criado ou apagado direto no Google Agenda pelo operador, **When** o cliente pergunta os horários livres, **Then** a resposta já reflete essa mudança.

---

### User Story 3 - Operador conecta a agenda e define as regras (Priority: P1)

No painel, o operador conecta a conta Google da clínica (autorizando o acesso à agenda), escolhe qual agenda da conta será usada e define as regras de atendimento: dias da semana e horários de funcionamento, duração da consulta e antecedência mínima para marcar. O painel mostra se a agenda está conectada e com qual conta, e permite desconectar.

**Why this priority**: Sem a agenda conectada e sem regras, o assistente não tem o que consultar nem onde marcar. É pré-requisito das outras stories.

**Independent Test**: Pelo painel, conectar uma conta Google de teste, escolher a agenda, salvar regras de atendimento e conferir que o painel mostra a conta conectada. Desconectar e conferir que o assistente deixa de oferecer horários.

**Acceptance Scenarios**:

1. **Given** nenhuma agenda conectada, **When** o operador clica em conectar e autoriza o acesso na tela do Google, **Then** volta ao painel, que mostra a conta conectada.
2. **Given** a conta conectada com mais de uma agenda, **When** o operador escolhe uma delas, **Then** os horários passam a ser lidos e marcados só nessa agenda.
3. **Given** a agenda conectada, **When** o operador define atendimento de segunda a sexta, das 9h às 18h, com consultas de 60 minutos, **Then** o assistente só oferece horários dentro dessas regras.
4. **Given** o operador cancela a autorização na tela do Google, **When** volta ao painel, **Then** a agenda continua desconectada e o painel mostra um aviso.
5. **Given** a agenda conectada, **When** o operador desconecta e confirma, **Then** o Secretaryfy perde o acesso à agenda e o painel volta a oferecer a conexão.
6. **Given** a autorização foi revogada pelo lado do Google (ex.: senha trocada ou acesso removido), **When** o assistente tenta consultar a agenda, **Then** o painel passa a mostrar que a agenda precisa ser reconectada.

---

### User Story 4 - Operador acompanha os agendamentos feitos pelo assistente (Priority: P2)

No histórico da conversa no painel, o operador vê quando o assistente marcou um horário, com o dia e a hora. O evento criado na agenda traz o nome do cliente, o número de WhatsApp e a indicação de que foi marcado pelo assistente, para o operador reconhecer de onde veio.

**Why this priority**: Dá rastreabilidade ao que o assistente faz em nome da clínica. O agendamento funciona sem isso, mas o operador ficaria sem saber o que foi marcado por quem.

**Independent Test**: Fazer um agendamento pelo WhatsApp de teste e conferir que o histórico da conversa no painel mostra o registro da marcação e que o evento no Google Agenda tem nome, número e a origem.

**Acceptance Scenarios**:

1. **Given** o assistente marcou um horário, **When** o operador abre a conversa no painel, **Then** vê no histórico um registro da marcação com dia e horário.
2. **Given** o assistente marcou um horário, **When** o operador abre o evento no Google Agenda, **Then** o evento tem o nome do cliente, o número de WhatsApp e a indicação de que foi marcado pelo Secretaryfy.

---

### User Story 5 - Cliente cancela ou remarca o horário (Priority: P3)

O cliente que já tem horário marcado pede para cancelar ou trocar o horário. O assistente encontra o agendamento desse cliente, confirma qual é e, conforme o pedido, cancela ou oferece novos horários e remarca.

**Why this priority**: É comum e fecha o ciclo do agendamento pelo WhatsApp, mas o pedido central é marcar e consultar horários. Por isso vem depois das outras stories.

**Independent Test**: Com um horário marcado pelo assistente, pedir pelo WhatsApp de teste para remarcar, escolher outro horário e conferir que o evento antigo sumiu e o novo aparece na agenda.

**Acceptance Scenarios**:

1. **Given** o cliente tem um horário futuro marcado pelo assistente, **When** pede para cancelar e confirma, **Then** o evento é removido da agenda e o assistente confirma o cancelamento.
2. **Given** o cliente tem um horário futuro marcado, **When** pede para remarcar, escolhe um novo horário e confirma, **Then** o horário antigo é liberado e o novo é marcado.
3. **Given** o cliente não tem horário marcado, **When** pede para cancelar, **Then** o assistente diz que não encontrou agendamento no número dele.
4. **Given** o prazo de cancelamento é de 24 horas e o horário do cliente é daqui a 5 horas, **When** ele pede para cancelar ou remarcar, **Then** a agenda não é alterada e o assistente orienta o cliente a falar com a clínica.
5. **Given** o cliente tem um horário futuro marcado, **When** pede para marcar outro, **Then** o assistente informa o horário existente e oferece remarcá-lo, sem criar um segundo.

---

### Edge Cases

- **Agenda desconectada ou indisponível**: quando o cliente pede horários ou tenta marcar e a agenda não responde, o assistente diz que não consegue agendar no momento e sugere tentar mais tarde ou falar com a clínica. Nada fica marcado pela metade.
- **Dois clientes escolhendo o mesmo horário**: só o primeiro a confirmar fica com o horário. O segundo é avisado e recebe novas opções (ver US1, cenário 5).
- **Horário no passado ou dentro da antecedência mínima**: não é oferecido nem aceito, mesmo que o cliente peça.
- **Pedido muito distante**: datas além do limite de dias à frente não são oferecidas. O assistente explica até quando pode marcar.
- **Data ambígua ou inválida** ("next Friday" perto da virada da semana, "February 30"): o assistente confirma a data por extenso antes de seguir.
- **Evento de dia inteiro ou evento longo na agenda**: bloqueia todos os horários que ele cobre.
- **Cliente já tem horário marcado e pede outro**: o assistente informa o horário existente e oferece remarcá-lo. Um segundo horário futuro não é criado (FR-019).
- **Conversa pausada pelo operador**: o assistente não responde nem marca nada, como na feature 002, mesmo no meio de um agendamento.
- **Cliente some no meio do agendamento**: nada é marcado sem a confirmação final. Se o cliente voltar depois de muito tempo, os horários são consultados de novo antes de confirmar.
- **Fuso horário**: todos os horários são falados e marcados no fuso da clínica, mesmo que o cliente esteja em outro.
- **Cliente sem nome no WhatsApp**: o assistente pergunta o nome antes de confirmar.
- **Assistente não entende o cliente**: depois de 2 tentativas seguidas sem entender, o cliente é avisado de que a clínica vai continuar o atendimento, o assistente é pausado na conversa e ela fica destacada no painel (FR-024a, FR-024b).
- **Evento alterado direto no Google Agenda**: se o operador apagou o evento de um cliente, o cliente fica sem horário marcado e pode marcar de novo. Se o operador moveu o evento, o assistente informa e trata o horário novo (FR-018a).

## Requirements *(mandatory)*

### Functional Requirements

**Conexão da agenda**

- **FR-001**: O operador MUST conseguir conectar uma conta Google da clínica pelo painel, autorizando o acesso à agenda na tela de consentimento do Google.
- **FR-002**: O operador MUST conseguir escolher qual agenda da conta conectada é usada para consultar e marcar horários.
- **FR-003**: O painel MUST mostrar se a agenda está conectada, com qual conta e qual agenda, e avisar quando a autorização deixar de valer e for preciso reconectar.
- **FR-004**: O operador MUST conseguir desconectar a agenda, com confirmação. Depois disso, o Secretaryfy não lê nem escreve mais nessa agenda.
- **FR-005**: O acesso à agenda MUST ficar guardado de forma protegida e sobreviver a reinícios do servidor, sem pedir nova autorização a cada vez.
- **FR-006**: Só o operador logado no painel MUST conseguir conectar, trocar ou desconectar a agenda.

**Regras de atendimento**

- **FR-007**: O operador MUST conseguir definir pelo painel os dias da semana de atendimento e o horário de início e fim de cada dia.
- **FR-008**: O operador MUST conseguir definir a duração da consulta, a antecedência mínima para marcar, até quantos dias à frente o cliente pode marcar e o prazo mínimo antes do horário para o cliente cancelar ou remarcar pelo WhatsApp.
- **FR-009**: Os horários oferecidos MUST começar no início do atendimento e seguir em intervalos da duração da consulta, terminando dentro do horário de atendimento.

**Consulta de disponibilidade**

- **FR-010**: Um horário MUST ser considerado livre só se estiver dentro das regras de atendimento, respeitar a antecedência mínima e o limite de dias à frente, e não coincidir com nenhum evento ocupado da agenda escolhida.
- **FR-011**: O assistente MUST conseguir informar ao cliente os dias com pelo menos um horário livre e os horários livres de um dia específico.
- **FR-012**: A disponibilidade MUST ser lida da agenda no momento da pergunta, refletindo eventos criados, alterados ou apagados direto no Google Agenda.
- **FR-013**: Ao listar dias ou horários, o assistente MUST apresentá-los como opções numeradas, numa quantidade curta e legível no WhatsApp (por padrão, até 6 por resposta), oferecendo mais se o cliente pedir.
- **FR-013a**: O cliente MUST conseguir escolher respondendo só o número da opção. O assistente também MUST aceitar pedidos simples de data em texto (ex.: "tomorrow", "Friday", "next Monday") e responder com as opções numeradas daquele dia.

**Agendamento**

- **FR-014**: O assistente MUST pedir a confirmação explícita do cliente, mostrando dia, horário e nome, antes de criar qualquer evento.
- **FR-015**: Antes de criar o evento, o sistema MUST verificar de novo se o horário continua livre. Se não estiver, nada é criado e o cliente recebe novas opções.
- **FR-016**: O evento criado MUST ter a duração da consulta e trazer o nome do cliente, o número de WhatsApp e a indicação de que foi marcado pelo Secretaryfy.
- **FR-017**: Depois de criar o evento, o assistente MUST confirmar ao cliente o dia e o horário marcados.
- **FR-018**: O sistema MUST guardar cada agendamento feito pelo assistente, ligado à conversa do cliente, e mostrar um registro dele no histórico da conversa no painel.
- **FR-018a**: O Google Agenda MUST ser a fonte da verdade dos agendamentos. Antes de informar, cancelar, remarcar ou usar um agendamento para bloquear um novo, o sistema confere o evento na agenda: se ele foi apagado, o agendamento passa a contar como cancelado; se foi movido, passa a valer o horário novo.
- **FR-019**: Cada número de WhatsApp MUST ter no máximo um horário futuro marcado pelo assistente. Se o cliente que já tem um pedir para marcar, o assistente informa o horário existente e oferece remarcá-lo, sem criar um segundo evento.

**Conversa**

- **FR-020**: O assistente MUST levar em conta as mensagens anteriores da conversa para entender respostas curtas como "yes", "the 10 am one" ou "tomorrow".
- **FR-021**: O assistente MUST continuar respondendo as dúvidas sobre a clínica pelo folheto, como na feature 001, e voltar ao agendamento quando o cliente pedir.
- **FR-022**: Com a agenda desconectada ou indisponível, o assistente MUST dizer ao cliente que não consegue agendar no momento, sem inventar horários.
- **FR-023**: O assistente MUST respeitar a pausa da conversa definida pelo operador (feature 002): com a conversa pausada, ele não responde nem marca.
- **FR-024**: O assistente MUST nunca afirmar que marcou um horário que não foi de fato criado na agenda.
- **FR-024a**: Depois de 2 respostas seguidas do cliente que o assistente não consegue interpretar durante um agendamento (dia, opção ou confirmação), o assistente MUST avisar o cliente que alguém da clínica vai continuar o atendimento e pausar o assistente nessa conversa, como a pausa da feature 002.
- **FR-024b**: Uma conversa pausada por esse motivo MUST aparecer destacada no painel como "precisa de atendimento", até o operador abri-la ou reativar o assistente.
- **FR-025**: O agente que conduz a conversa de agendamento MUST rodar só com modelos locais, sem custo por mensagem e sem enviar as conversas a serviços de IA na nuvem, como na feature 001.

**Cancelar e remarcar** (ver US5)

- **FR-026**: O cliente MUST conseguir cancelar ou remarcar pelo WhatsApp um horário futuro marcado pelo assistente no número dele, com confirmação antes da mudança.
- **FR-027**: Cancelar e remarcar pelo WhatsApp MUST ser permitido só até o prazo definido pelo operador antes do horário marcado. Dentro do prazo, o assistente não altera a agenda e orienta o cliente a falar com a clínica.

### Key Entities

- **Agenda conectada**: a conta Google da clínica e a agenda escolhida. Guarda o e-mail da conta, a agenda escolhida, o acesso autorizado (protegido) e se a autorização continua válida. Há uma por instalação.
- **Regras de atendimento**: dias da semana e horários de funcionamento, duração da consulta, antecedência mínima, limite de dias à frente e prazo para cancelar ou remarcar. Uma por instalação.
- **Horário livre**: calculado na hora, a partir das regras e dos eventos da agenda. Não é guardado.
- **Agendamento**: pertence a uma conversa (cliente). Guarda o dia e o horário, a duração, o nome do cliente, o evento correspondente no Google Agenda, quando foi marcado e a situação (marcado, cancelado). A agenda prevalece: dia, horário e situação são conferidos no evento antes de cada uso.
- **Conversa** (feature 002): ganha o histórico das últimas mensagens como contexto do assistente, o registro dos agendamentos feitos nela e a indicação de que precisa de atendimento quando o assistente desistiu de entender o cliente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um cliente consegue marcar um horário livre em até 6 mensagens próprias, a partir de "I'd like to book an appointment".
- **SC-002**: Em um roteiro de teste com pelo menos 20 conversas de agendamento, 100% dos horários oferecidos estão de fato livres e dentro das regras de atendimento.
- **SC-003**: 0 horários marcados em duplicidade ou sobre eventos já existentes na agenda durante os testes, incluindo dois clientes disputando o mesmo horário.
- **SC-004**: 0 eventos criados sem a confirmação explícita do cliente, e 0 confirmações ao cliente de horários que não foram criados na agenda.
- **SC-005**: Pelo menos 90% das conversas do roteiro de teste terminam com o horário que o cliente pediu marcado corretamente (dia e hora certos no fuso da clínica).
- **SC-006**: Uma mudança feita direto no Google Agenda aparece na próxima resposta de disponibilidade do assistente.
- **SC-007**: Um operador que nunca usou a feature conecta a agenda e define as regras pelo painel em menos de 5 minutos.
- **SC-008**: A resposta do assistente a um pedido de horários chega ao cliente em até 30 segundos.
- **SC-009**: Nenhum cliente recebe mais de 2 respostas seguidas de "não entendi" numa conversa de agendamento: na terceira, a conversa já está com o operador.

## Assumptions

- A agenda é **da clínica**, conectada uma única vez pelo operador. Os clientes não conectam a conta Google deles. O vínculo atual de conta Google por cliente, feito no início do projeto e sem uso, dá lugar a uma única agenda da instalação.
- Os eventos marcados são para **avaliação** da DentalSafe, todos com a mesma duração. Tipos diferentes de consulta, com durações diferentes, ficam para depois.
- O assistente marca o horário direto na agenda, sem aprovação prévia do operador. O operador acompanha pelo painel e pelo próprio Google Agenda.
- Qualquer evento ocupado na agenda escolhida bloqueia o horário, inclusive compromissos pessoais. Eventos marcados como "disponível" no Google Agenda não bloqueiam.
- O fuso horário é o da agenda escolhida, e todos os horários falados ao cliente estão nesse fuso.
- Valores padrão das regras até o operador mudar: segunda a sexta, das 9h às 18h, consultas de 60 minutos, antecedência mínima de 2 horas, até 30 dias à frente e cancelamento ou remarcação até 24 horas antes.
- Um cliente é identificado pelo número de WhatsApp. O nome vem do perfil do WhatsApp, e o assistente pergunta quando não houver.
- O assistente continua conversando em inglês, como nas features 001 e 002. O painel continua em português.
- Nenhum convite por e-mail é enviado ao cliente: o evento fica só na agenda da clínica, e a confirmação ao cliente é pela conversa do WhatsApp.
- O contexto da conversa considera as mensagens recentes dela (por padrão, as últimas 20), não o histórico inteiro.
- Pré-requisito do ambiente: um projeto no Google Cloud com a API do Google Agenda ativada, a URL de retorno do Secretaryfy cadastrada e a conta da clínica liberada como usuária de teste enquanto o app não passar pela verificação do Google.
- Fora do escopo: lembretes automáticos antes da consulta, lista de espera, pagamento ou sinal, vários profissionais ou salas com agendas separadas, feriados automáticos (o operador bloqueia o dia direto na agenda), envio de e-mail, agendamento pelo painel feito pelo operador (ele usa o próprio Google Agenda) e outros provedores de agenda.
