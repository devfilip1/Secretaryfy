# Feature Specification: Nome do cliente, cadastro de clientes e serviço no agendamento

**Feature Branch**: `005-customer-name-registry`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "Está funcionando perfeitamente, mas vamos fazer alguns ajustes. Sempre que começar a conversa pergunte o nome do cliente. Toda vez que um cliente novo fizer o agendamento de alguma consulta, Adicione o cliente no banco de dados em alguma tabela de clientes, que terá como colunas o nome dele, o ID e o número de telefone. Adicione ao nome dos agendamentos no Google Calendar o nome do cliente e o serviço que ele quer fazer."

## Contexto

Hoje o assistente da DentalSafe responde dúvidas pelo folheto (feature 001) e marca horários no Google Agenda da clínica (feature 003). O nome do cliente só é perguntado no fim do agendamento ("What name should I put on the appointment?") e não fica guardado em lugar nenhum além do evento da agenda. O evento é criado sempre com o título "Avaliação — <nome>", sem dizer qual tratamento o cliente quer fazer, e a clínica não tem uma lista dos clientes que já marcaram.

Esta feature faz três ajustes:

1. O **assistente** pergunta o nome do **cliente** logo no começo da conversa e passa a chamá-lo pelo nome.
2. Quem marca um horário pela primeira vez entra num **cadastro de clientes** da clínica, com nome e número de telefone.
3. O evento criado no Google Agenda passa a ter no título o nome do cliente e o **serviço** (tratamento) que ele quer fazer, para a equipe da clínica saber de relance quem vem e para quê.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O assistente pergunta o nome no começo da conversa (Priority: P1)

Um cliente que a clínica ainda não conhece manda a primeira mensagem. O assistente responde de forma acolhedora e pergunta como ele se chama. Se a primeira mensagem já trouxer uma pergunta ("How much is whitening?"), o assistente responde a pergunta e, na mesma resposta, pergunta o nome, sem deixar o cliente sem resposta. Quando o cliente diz o nome, o assistente o guarda e passa a usá-lo na conversa.

**Why this priority**: Foi o primeiro pedido e muda a primeira impressão de toda conversa. Também é de onde vem o nome usado no cadastro e no título do evento (histórias 2 e 3).

**Independent Test**: Com um número de WhatsApp que nunca falou com a clínica, mandar "Hi", conferir que o assistente pergunta o nome, responder "Maria" e conferir que o assistente segue a conversa chamando a cliente de Maria e que o painel mostra o nome dela na conversa.

**Acceptance Scenarios**:

1. **Given** um número que nunca conversou com a clínica, **When** o cliente manda "Hi", **Then** o assistente cumprimenta e pergunta o nome dele.
2. **Given** um número que nunca conversou com a clínica, **When** a primeira mensagem é uma pergunta sobre a clínica, **Then** o assistente responde a pergunta e também pergunta o nome, numa mesma resposta.
3. **Given** o assistente perguntou o nome, **When** o cliente responde "My name is Maria Souza" ou só "Maria", **Then** o nome fica guardado para a conversa e o assistente responde usando o nome.
4. **Given** o nome do cliente já é conhecido, **When** ele volta a mandar mensagem outro dia, **Then** o assistente não pergunta o nome de novo.
5. **Given** o assistente perguntou o nome, **When** o cliente ignora e faz outra pergunta, **Then** o assistente responde a pergunta normalmente e não insiste no nome a cada mensagem.

---

### User Story 2 - O evento na agenda mostra o nome do cliente e o serviço (Priority: P1)

Ao marcar um horário, o assistente sabe qual tratamento o cliente quer: se ele já falou de um tratamento na conversa (por exemplo, perguntou sobre limpeza), o assistente o usa; se não, pergunta qual serviço ele quer, oferecendo os tratamentos da clínica e a opção de uma avaliação geral. O resumo antes da confirmação mostra dia, horário, nome e serviço, e o evento criado no Google Agenda tem no título o nome do cliente e o serviço.

**Why this priority**: É o que a equipe da clínica vê na agenda todos os dias. Sem o serviço no título, ela não sabe para que o cliente vem nem quanto tempo reservar mentalmente.

**Independent Test**: Pelo WhatsApp, perguntar sobre clareamento, pedir para marcar, confirmar e conferir no Google Agenda que o evento se chama, por exemplo, "Maria Souza — Teeth Whitening".

**Acceptance Scenarios**:

1. **Given** o cliente perguntou sobre um tratamento na conversa, **When** pede para marcar, **Then** o assistente usa esse tratamento como serviço do agendamento e o mostra no resumo antes da confirmação.
2. **Given** o cliente não falou de nenhum tratamento, **When** pede para marcar, **Then** o assistente pergunta qual serviço ele quer, oferecendo os tratamentos da clínica e uma avaliação geral para quem não sabe.
3. **Given** o cliente não sabe qual tratamento precisa, **When** responde "I'm not sure", **Then** o serviço do agendamento é uma avaliação geral.
4. **Given** o resumo com o serviço, **When** o cliente diz que quer outro serviço, **Then** o assistente troca o serviço e mostra o resumo de novo, sem marcar nada antes da confirmação.
5. **Given** o cliente confirmou, **When** o evento é criado, **Then** o título do evento traz o nome do cliente e o serviço.
6. **Given** um horário marcado, **When** o cliente o remarca pelo WhatsApp, **Then** o evento no novo horário mantém o nome e o serviço no título.

---

### User Story 3 - Quem marca pela primeira vez entra no cadastro de clientes (Priority: P2)

Quando um cliente que ainda não está no cadastro confirma o primeiro horário, ele passa a constar no cadastro de clientes da clínica com um identificador, o nome e o número de telefone. Quem já está no cadastro não é duplicado ao marcar de novo.

**Why this priority**: Foi pedido explicitamente e dá à clínica uma lista de quem já agendou. Fica em P2 porque o agendamento funciona sem o cadastro; o cadastro é o registro que fica para depois.

**Independent Test**: Com um número novo, marcar um horário pelo WhatsApp e conferir que o cliente aparece no cadastro com nome e telefone. Marcar de novo com o mesmo número e conferir que continua havendo um único registro desse cliente.

**Acceptance Scenarios**:

1. **Given** um número que não está no cadastro, **When** o cliente confirma um horário e o evento é criado na agenda, **Then** o cliente passa a constar no cadastro com identificador, nome e número de telefone.
2. **Given** um cliente já cadastrado, **When** ele marca outro horário, **Then** nenhum registro novo é criado para ele.
3. **Given** um cliente já cadastrado, **When** ele marca um horário informando um nome diferente do cadastrado, **Then** o cadastro passa a ter o nome mais recente.
4. **Given** o cliente desistiu antes de confirmar, ou a marcação falhou na agenda, **When** a conversa termina, **Then** ele não é incluído no cadastro.
5. **Given** um cliente cadastrado, **When** ele volta a conversar, **Then** o assistente já o conhece pelo nome do cadastro e não pergunta o nome de novo.

---

### Edge Cases

- O cliente responde ao pedido de nome com algo que não é um nome ("why?", "no", um emoji): o assistente não guarda isso como nome, segue a conversa e só volta a pedir o nome na hora de marcar.
- O cliente não quer dizer o nome: a conversa segue normalmente; o nome continua sendo obrigatório só para confirmar um agendamento, como hoje.
- O cliente escreve o nome com apelido ou só o primeiro nome: vale o que ele escreveu.
- O cliente corrige o nome depois ("actually it's Mariana"): vale o nome corrigido para a conversa, o resumo e o cadastro.
- O nome do perfil do WhatsApp é diferente do nome que o cliente disse: vale o nome dito na conversa.
- O cliente quer marcar mais de um serviço no mesmo horário: o assistente registra o principal que ele disser; os demais ficam para a equipe combinar na avaliação.
- O cliente pede um serviço que a clínica não oferece: o assistente diz que não tem essa informação e oferece os tratamentos da clínica ou uma avaliação geral.
- A conversa foi apagada pelo operador (botão de apagar conversas) ou o número foi desconectado: o cadastro de clientes não é apagado junto, e o cliente continua conhecido pelo nome quando voltar.
- O cliente já começou um agendamento antes de dizer o nome: o assistente pede o nome na etapa de agendamento, como hoje, e o usa dali em diante.

## Requirements *(mandatory)*

### Functional Requirements

**Nome do cliente**

- **FR-001**: O assistente MUST perguntar o nome do cliente na primeira resposta a um número cujo nome ainda não é conhecido.
- **FR-002**: Quando a primeira mensagem do cliente trouxer uma pergunta, o assistente MUST responder a pergunta e pedir o nome na mesma resposta, sem deixar a pergunta sem resposta.
- **FR-003**: O sistema MUST reconhecer o nome quando o cliente o disser na conversa, em frases como "I'm Maria", "My name is Maria Souza" ou só "Maria" logo depois do pedido de nome, e MUST guardá-lo como o nome do cliente daquele número.
- **FR-004**: O sistema MUST NOT guardar como nome uma resposta que não seja um nome (pergunta, recusa, saudação, emoji).
- **FR-005**: O assistente MUST NOT pedir o nome mais de uma vez fora do agendamento; se o cliente não disser, a conversa segue normalmente.
- **FR-006**: Com o nome conhecido, o assistente MUST NOT perguntá-lo de novo, nem em conversas de outros dias, e MAY usá-lo para chamar o cliente.
- **FR-007**: O agendamento MUST usar o nome já conhecido em vez de perguntar de novo, mostrando-o no resumo antes da confirmação, onde o cliente pode corrigi-lo.
- **FR-008**: O painel MUST mostrar na conversa o nome dito pelo cliente, no lugar do nome do perfil do WhatsApp.

**Serviço do agendamento**

- **FR-009**: Todo agendamento MUST ter um serviço: um dos tratamentos oferecidos pela clínica ou uma avaliação geral.
- **FR-010**: Quando o cliente tiver falado de um tratamento da clínica na conversa, o assistente MUST usá-lo como serviço do agendamento.
- **FR-011**: Quando não houver tratamento na conversa, o assistente MUST perguntar o serviço antes do resumo, oferecendo os tratamentos da clínica em opções numeradas e a avaliação geral; "não sei" ou equivalente MUST resultar em avaliação geral.
- **FR-012**: O resumo antes da confirmação MUST mostrar dia, horário, nome e serviço, e o cliente MUST poder trocar o serviço antes de confirmar.
- **FR-013**: O título do evento criado no Google Agenda MUST conter o nome do cliente e o serviço, no formato "<nome> — <serviço>".
- **FR-014**: Ao remarcar pelo WhatsApp, o evento MUST manter o nome e o serviço no título.

**Cadastro de clientes**

- **FR-015**: Quando um agendamento for confirmado e o evento criado na agenda, o sistema MUST incluir o cliente no cadastro de clientes se o número ainda não estiver nele, com um identificador único, o nome e o número de telefone.
- **FR-016**: O cadastro MUST ter no máximo um registro por número de telefone; um novo agendamento do mesmo número MUST NOT criar outro registro.
- **FR-017**: Se o cliente cadastrado informar um nome diferente num novo agendamento, o cadastro MUST passar a ter o nome mais recente.
- **FR-018**: Um agendamento que não chegou a ser criado na agenda (desistência, horário ocupado, falha) MUST NOT incluir o cliente no cadastro.
- **FR-019**: O cadastro de clientes MUST continuar existindo quando as conversas forem apagadas pelo operador ou quando o número do WhatsApp for desconectado.
- **FR-020**: O nome do cadastro MUST valer como nome conhecido do cliente nas conversas seguintes (FR-006).

### Key Entities

- **Cliente**: pessoa que já marcou ao menos um horário pela clínica. Tem um identificador único, o nome e o número de telefone (único no cadastro). Existe independentemente das conversas: apagar conversas não apaga clientes.
- **Nome conhecido do cliente**: o nome que o cliente disse na conversa (ou o do cadastro, se ele já for cliente), ligado ao número de telefone. Usado pelo assistente, pelo painel e pelo agendamento.
- **Serviço**: o tratamento que o cliente quer fazer no horário marcado, escolhido entre os tratamentos do folheto da clínica (Dental Cleaning, Teeth Whitening, Dental Filling, Root Canal Treatment, Dental Implants, Braces and Orthodontic Treatment, Tooth Extraction, Dental Veneers) ou uma avaliação geral.
- **Agendamento** (existente, feature 003): passa a ter também o serviço; o título do evento na agenda é formado pelo nome do cliente e pelo serviço.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em 100% das conversas com números ainda sem nome conhecido, a primeira resposta do assistente pede o nome do cliente.
- **SC-002**: Nenhum cliente com nome conhecido recebe de novo o pedido de nome fora da etapa de confirmação do agendamento.
- **SC-003**: 100% dos eventos criados pelo assistente na agenda têm no título o nome do cliente e um serviço.
- **SC-004**: Em testes com conversas que citam um tratamento antes do pedido de agendamento, o serviço do evento é esse tratamento em pelo menos 9 de cada 10 casos.
- **SC-005**: Depois de qualquer número de agendamentos, cada número de telefone aparece no máximo uma vez no cadastro de clientes.
- **SC-006**: Todo cliente que confirmou um horário com sucesso consta no cadastro; nenhum cliente que só conversou ou desistiu aparece nele.
- **SC-007**: Marcar um horário não fica mais longo do que hoje para quem já disse o nome: no máximo uma pergunta a mais (o serviço), e nenhuma quando o tratamento já foi citado.

## Assumptions

- "Começar a conversa" quer dizer o primeiro contato de um número cujo nome ainda não é conhecido; quem já disse o nome ou já está no cadastro não é perguntado de novo.
- O pedido de nome não bloqueia a conversa: o cliente pode ignorá-lo, e o nome só é obrigatório para confirmar um agendamento (como já é hoje).
- O cadastro de clientes recebe apenas quem confirmou um horário com sucesso, como pedido ("toda vez que um cliente novo fizer o agendamento"). Quem só conversou fica com o nome guardado na conversa, mas fora do cadastro.
- "Cliente novo" é um número de telefone que ainda não está no cadastro; o número é a chave para saber se o cliente é o mesmo.
- Os serviços são os tratamentos do folheto da clínica, com os nomes em inglês como lá estão, mais uma avaliação geral ("Assessment"), que é o que o assistente já marca hoje.
- O título do evento segue o formato "<nome> — <serviço>" (por exemplo, "Maria Souza — Dental Cleaning"); a descrição do evento continua com o número de WhatsApp, como hoje.
- Horários já marcados antes desta feature continuam como estão; não há migração dos eventos antigos nem inclusão retroativa no cadastro.
- Consultar ou editar o cadastro de clientes pelo painel fica fora do escopo desta feature; o pedido é registrar os clientes.
- O assistente continua respondendo ao cliente em inglês, e os registros e telas do painel continuam em português.
