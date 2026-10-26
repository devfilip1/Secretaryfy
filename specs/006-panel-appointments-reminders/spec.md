# Feature Specification: Agendamentos no painel, ficha do cliente e lembrete pelo WhatsApp

**Feature Branch**: `006-panel-appointments-reminders`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "vamos adicionar algumas features: 1- Aba de agendamentos. Uma lista dos próximos horários (hoje, amanhã, semana) com nome, serviço e telefone, mais um link para abrir a conversa. Hoje o dono precisa ir ao Google Agenda para ver isso. A tabela appointments já tem tudo. 2- Editar o cadastro do cliente. Corrigir nome errado ("Maria" → "Maria Souza") direto na aba Clientes. É o complemento natural da exclusão. 3- Abrir a conversa a partir do cliente. Um botão "Ver conversa" na ficha. 4- Lembrete automático pelo WhatsApp 24 h antes do horário, com "responda YES para confirmar". Reduz faltas, mas precisa passar pela proteção anti-ban, que já existe. O ganho é alto e o esforço médio. 5- Marcar pelo painel. O operador marca um horário para um cliente que ligou, usando a mesma checagem de horários livres do assistente. 6- Anotações no cliente: um campo livre do tipo "alérgico a látex" ou "prefere manhã"."

## Contexto

Hoje o assistente marca, cancela e remarca horários pelo WhatsApp no Google Agenda da clínica (feature 003). Quem confirma um horário entra no cadastro de clientes, que o painel mostra numa aba própria, onde o dono pode consultar a ficha e excluir o registro (feature 005). Faltam quatro coisas no dia a dia da clínica:

1. **Ver a agenda sem sair do painel**: para saber quem vem hoje ou amanhã, o dono precisa abrir o Google Agenda, e de lá não chega à conversa com o cliente.
2. **Cuidar da ficha do cliente**: não dá para corrigir um nome errado nem guardar observações como "alérgico a látex".
3. **Marcar para quem ligou**: o operador não tem como marcar pelo painel um horário para um cliente que telefonou, com a mesma garantia de horário livre que o assistente tem.
4. **Diminuir as faltas**: ninguém lembra o cliente da consulta.

Esta feature junta os seis pedidos nessas quatro frentes. O painel está em inglês (os nomes de telas e botões abaixo seguem essa língua); o assistente fala com o cliente em inglês.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aba de agendamentos com os próximos horários (Priority: P1)

O dono abre a aba **Appointments** do painel e vê os próximos horários marcados, separados em **hoje**, **amanhã** e **próximos 7 dias**. Cada linha mostra o horário, o nome do cliente, o serviço, o telefone e se o cliente já confirmou presença. Um botão abre a conversa daquele cliente no painel. A lista se atualiza sozinha quando um horário é marcado, remarcado ou cancelado.

**Why this priority**: É o que o dono consulta todo dia e hoje exige sair do painel. Também é a tela onde aparecem o resultado do lembrete (história 4) e os horários marcados pelo painel (história 5).

**Independent Test**: Marcar dois horários pelo WhatsApp, um para hoje e um para daqui a 3 dias, abrir a aba Appointments e conferir que cada um aparece no grupo certo com nome, serviço e telefone; clicar em abrir a conversa e cair na conversa daquele cliente.

**Acceptance Scenarios**:

1. **Given** horários marcados para hoje, amanhã e daqui a 5 dias, **When** o dono abre a aba Appointments, **Then** vê cada horário no grupo certo (Today, Tomorrow, Next 7 days), em ordem de horário, com nome, serviço e telefone.
2. **Given** um horário na lista, **When** o dono clica para abrir a conversa, **Then** o painel mostra a conversa daquele cliente.
3. **Given** a aba aberta, **When** o assistente marca, remarca ou cancela um horário pelo WhatsApp, **Then** a lista muda sem recarregar a página.
4. **Given** um horário cancelado ou que já passou, **When** o dono abre a aba, **Then** esse horário não aparece entre os próximos.
5. **Given** nenhum horário nos próximos 7 dias, **When** o dono abre a aba, **Then** vê um aviso de que não há horários marcados.
6. **Given** um horário cuja conversa foi apagada, **When** o dono olha a linha, **Then** o horário aparece normalmente, mas sem a opção de abrir a conversa.

---

### User Story 2 - Ficha do cliente: editar nome, anotações e abrir a conversa (Priority: P1)

Na aba **Customers**, o dono abre a ficha de um cliente, corrige o nome ("Maria" → "Maria Souza") e escreve anotações livres ("allergic to latex", "prefers mornings"). Um botão **View conversation** leva à conversa do cliente. O nome corrigido passa a valer para o assistente e para os próximos horários dele na agenda. As anotações aparecem também na aba de agendamentos, ao lado do horário do cliente.

**Why this priority**: Complementa a exclusão que já existe e corrige um problema real (nome errado no título do evento). É barato e independente das outras histórias.

**Independent Test**: Abrir a ficha de um cliente com um horário futuro, trocar o nome, salvar e conferir que a ficha, a conversa no painel e o título do evento no Google Agenda mostram o nome novo; escrever uma anotação, recarregar a página e conferir que ela continua lá.

**Acceptance Scenarios**:

1. **Given** a ficha de um cliente, **When** o dono troca o nome e salva, **Then** a ficha e a lista de clientes mostram o nome novo.
2. **Given** o nome trocado, **When** o cliente volta a escrever pelo WhatsApp, **Then** o assistente o chama pelo nome novo.
3. **Given** o cliente tem horários futuros marcados, **When** o dono troca o nome, **Then** o título desses eventos no Google Agenda passa a ter o nome novo.
4. **Given** o dono tenta salvar o nome vazio, **When** clica em salvar, **Then** o painel não aceita e mantém o nome anterior.
5. **Given** a ficha de um cliente, **When** o dono escreve uma anotação e salva, **Then** a anotação fica guardada e aparece na ficha e nos horários desse cliente na aba de agendamentos.
6. **Given** a ficha de um cliente com conversa no painel, **When** o dono clica em View conversation, **Then** o painel abre essa conversa.
7. **Given** a ficha de um cliente cuja conversa foi apagada, **When** o dono olha a ficha, **Then** o botão View conversation não aparece ou aparece desativado, com a explicação.

---

### User Story 3 - Marcar um horário pelo painel (Priority: P2)

Um cliente liga para a clínica. O operador abre **New appointment** no painel, informa o telefone, o nome e o serviço, escolhe um dia e vê só os horários livres, calculados com as mesmas regras e a mesma consulta ao Google Agenda que o assistente usa. Ao confirmar, o evento é criado na agenda com o título "<nome> — <serviço>", o horário aparece na aba de agendamentos e o cliente entra no cadastro, como acontece pelo WhatsApp.

**Why this priority**: Fecha o buraco de quem não usa o WhatsApp, mas depende das telas das histórias 1 e 2 para ser útil e é a parte mais trabalhosa do painel.

**Independent Test**: Pelo painel, marcar para um telefone novo um horário de amanhã; conferir que o evento aparece no Google Agenda com nome e serviço, que o horário aparece na aba Appointments, que o cliente aparece na aba Customers e que o mesmo horário deixa de ser oferecido pelo assistente.

**Acceptance Scenarios**:

1. **Given** o operador informou telefone, nome e serviço e escolheu um dia, **When** vê os horários, **Then** só aparecem horários livres na agenda e dentro das regras de atendimento.
2. **Given** um horário escolhido, **When** o operador confirma, **Then** o evento é criado no Google Agenda com o título "<nome> — <serviço>" e o horário aparece na aba de agendamentos.
3. **Given** o telefone ainda não está no cadastro, **When** o horário é marcado, **Then** o cliente entra no cadastro com o nome e o telefone informados.
4. **Given** o telefone já está no cadastro, **When** o operador começa a marcar, **Then** o painel preenche o nome do cadastro, que o operador pode corrigir.
5. **Given** o horário foi ocupado entre a escolha e a confirmação, **When** o operador confirma, **Then** nada é criado e o painel avisa e mostra os horários livres de novo.
6. **Given** o cliente já tem um horário futuro, **When** o operador tenta marcar outro para o mesmo telefone, **Then** o painel avisa que ele já tem horário e não marca um segundo, como o assistente faz.
7. **Given** um horário marcado pelo painel, **When** o cliente depois escreve pelo WhatsApp perguntando do horário, cancelando ou remarcando, **Then** o assistente trata esse horário como qualquer outro.
8. **Given** a agenda está desconectada, **When** o operador abre New appointment, **Then** o painel avisa que é preciso conectar a agenda.

---

### User Story 4 - Lembrete pelo WhatsApp 24 h antes, com confirmação (Priority: P2)

A partir de 24 horas antes de cada horário, o cliente recebe pelo WhatsApp um lembrete com dia, hora e serviço, pedindo que responda YES para confirmar, **desde que tenha escrito para a clínica nas últimas 24 horas**: a regra da feature 004 de nunca escrever primeiro para quem está calado continua valendo sem exceção. Quando o cliente está fora dessa janela, nada é enviado automaticamente e o horário fica destacado na aba de agendamentos como "lembrar manualmente", para o operador avisar por telefone ou pelo painel e marcar o horário como confirmado. Se o cliente responde YES ao lembrete, o horário fica confirmado; se pede para cancelar ou remarcar, o assistente segue o fluxo que já existe. Todo envio passa pela proteção do número (feature 004): limites, pausa, saída do cliente e textos variados.

**Why this priority**: É o de maior ganho para a clínica (menos faltas), mas mexe na regra mais sensível do produto, a de não chamar o cliente primeiro, e depende da aba de agendamentos para mostrar o resultado.

**Independent Test**: Marcar um horário para daqui a pouco mais de 24 horas, esperar o lembrete chegar no celular, responder YES e conferir que a aba Appointments mostra o horário como confirmado e que a conversa registra o lembrete.

**Acceptance Scenarios**:

1. **Given** um horário marcado com mais de 24 horas de antecedência, **When** faltam 24 horas, **Then** o cliente recebe um único lembrete com dia, hora e serviço, pedindo YES para confirmar.
2. **Given** o lembrete enviado, **When** o cliente responde YES, **Then** o assistente agradece e o horário aparece como confirmado na aba de agendamentos.
3. **Given** o lembrete enviado, **When** o cliente responde que quer cancelar ou remarcar, **Then** o assistente segue o fluxo de cancelamento ou remarcação, com confirmação, como já faz hoje.
4. **Given** o lembrete enviado, **When** o cliente não responde, **Then** o horário continua marcado e aparece como não confirmado na aba de agendamentos; nenhum segundo lembrete é enviado.
5. **Given** o horário foi marcado com menos de 24 horas de antecedência, **When** chega a hora, **Then** nenhum lembrete é enviado.
6. **Given** o cliente pediu para não receber mensagens, ou a proteção do número está pausada, **When** chega a hora do lembrete, **Then** nada é enviado e a aba de agendamentos mostra que o lembrete não saiu e por quê.
7. **Given** o horário foi cancelado ou remarcado antes da hora do lembrete, **When** chega a hora, **Then** nenhum lembrete do horário antigo é enviado; o horário novo tem o seu próprio lembrete.
8. **Given** o servidor estava desligado na hora do lembrete, **When** volta, **Then** o lembrete ainda é enviado se faltarem pelo menos 2 horas para o horário; senão, é descartado e registrado como não enviado.
9. **Given** o cliente não escreve há mais de 24 horas, **When** chega a hora do lembrete, **Then** nada é enviado e o horário aparece na aba de agendamentos como "lembrar manualmente".
10. **Given** um horário com "lembrar manualmente", **When** o cliente escreve para a clínica antes de faltarem 2 horas para o horário, **Then** o lembrete é enviado nessa janela aberta, uma única vez, depois da resposta do assistente.
11. **Given** um horário com "lembrar manualmente", **When** o operador avisou o cliente por conta própria e marca o horário como confirmado no painel, **Then** o horário aparece como confirmado e nenhum lembrete automático é enviado depois.

---

### Edge Cases

- Horário marcado direto no Google Agenda, sem passar pelo Secretaryfy: não aparece na aba de agendamentos e não recebe lembrete; só ocupa a vaga, como hoje.
- Horário apagado ou movido direto no Google Agenda: a aba e o lembrete seguem o Google, como o assistente já faz (feature 003, FR-018a); um horário apagado sai da lista e não recebe lembrete.
- O cliente responde "yes" ao lembrete e, logo depois, "actually I need to cancel": vale o pedido de cancelamento, com a confirmação de sempre.
- O cliente responde YES ao lembrete no meio de outro assunto com o assistente (por exemplo, numa conversa de remarcação aberta): o YES vale para a pergunta em aberto da conversa, não para o lembrete.
- Dois horários no mesmo dia para telefones diferentes no mesmo minuto: impossível, a agenda não deixa dois clientes no mesmo horário (feature 003).
- O dono troca o nome de um cliente cujo evento futuro foi apagado no Google: só os eventos que ainda existem são atualizados; nada falha por isso.
- A atualização do título no Google falha (agenda fora do ar): o nome novo fica salvo na ficha e o painel avisa que o título na agenda não foi atualizado.
- Telefone digitado no painel com espaços, traços, parênteses ou sem o código do país: o painel aceita e normaliza para o mesmo formato usado pelo WhatsApp, assumindo Brasil (+55) quando o código do país faltar.
- Operador marca pelo painel para um telefone que nunca falou com a clínica pelo WhatsApp: o horário e o cadastro são criados; não há conversa para abrir.
- Anotação muito longa: o painel limita o tamanho e avisa.
- Exclusão do cadastro de um cliente com horários futuros (feature 005): os horários continuam na aba de agendamentos e continuam recebendo lembrete; só perdem o vínculo com a ficha e as anotações.

## Requirements *(mandatory)*

### Functional Requirements

**Aba de agendamentos**

- **FR-001**: O painel MUST ter uma aba de agendamentos com os horários marcados pelo Secretaryfy (pelo assistente ou pelo painel) a partir de agora, agrupados em hoje, amanhã e próximos 7 dias, em ordem de horário.
- **FR-002**: Cada horário MUST mostrar dia e hora, nome do cliente, serviço, telefone, situação do lembrete e da confirmação (lembrete pendente, enviado, a lembrar manualmente, não enviado e o motivo; confirmado ou não) e as anotações do cliente, se houver.
- **FR-003**: Cada horário MUST oferecer abrir a conversa do cliente no painel quando ela existir.
- **FR-004**: Horários cancelados ou já passados MUST NOT aparecer entre os próximos.
- **FR-005**: A lista MUST se atualizar sem recarregar a página quando um horário for marcado, remarcado, cancelado ou confirmado.

**Ficha do cliente**

- **FR-006**: O dono MUST poder editar o nome de um cliente na ficha; nome vazio ou só com espaços MUST ser recusado.
- **FR-007**: O nome editado MUST passar a valer na conversa do cliente (o assistente e o painel usam o nome novo).
- **FR-008**: Ao editar o nome, o título dos eventos futuros desse cliente no Google Agenda MUST ser atualizado para "<nome novo> — <serviço>"; se a atualização falhar, o nome MUST continuar salvo e o painel MUST avisar.
- **FR-009**: O dono MUST poder escrever, alterar e apagar anotações livres na ficha de um cliente, com até 1.000 caracteres.
- **FR-010**: As anotações MUST ser visíveis só no painel; o assistente MUST NOT usá-las nem enviá-las ao cliente.
- **FR-011**: A ficha MUST ter um botão para abrir a conversa do cliente no painel quando ela existir; sem conversa, o botão MUST ficar indisponível com a explicação.

**Marcar pelo painel**

- **FR-012**: O operador MUST poder marcar um horário pelo painel informando telefone, nome e serviço (um dos serviços da clínica ou avaliação geral).
- **FR-013**: Os horários oferecidos no painel MUST ser calculados com as mesmas regras de atendimento e a mesma consulta de horários livres usadas pelo assistente.
- **FR-014**: Antes de criar o evento, o sistema MUST conferir de novo que o horário está livre; se não estiver, MUST NOT criar nada e MUST mostrar os horários livres de novo.
- **FR-015**: Um horário marcado pelo painel MUST ter o mesmo título de evento, o mesmo registro e o mesmo tratamento posterior (consulta, cancelamento e remarcação pelo WhatsApp, lembrete) que um marcado pelo assistente.
- **FR-016**: Marcar pelo painel MUST incluir ou atualizar o cliente no cadastro, como o agendamento pelo WhatsApp (feature 005, FR-015 a FR-017).
- **FR-017**: O painel MUST NOT marcar um segundo horário futuro para um telefone que já tem um, como o assistente (feature 003, FR-019).
- **FR-018**: O painel MUST aceitar o telefone em formatos comuns e normalizá-lo para o formato do WhatsApp, assumindo o Brasil quando o código do país faltar.
- **FR-019**: Marcar pelo painel MUST NOT enviar mensagem ao cliente no momento da marcação.

**Lembrete**

- **FR-020**: O sistema MUST enviar um único lembrete pelo WhatsApp por horário marcado com mais de 24 horas de antecedência, com dia, hora e serviço, pedindo YES para confirmar, no primeiro momento entre 24 horas e 2 horas antes do horário em que a última mensagem do cliente tiver menos de 24 horas.
- **FR-021**: Todo lembrete MUST passar pela proteção do número (feature 004): limites por minuto, hora e dia, pausa da proteção, cliente que pediu para sair, textos variados e simulação de digitação.
- **FR-022**: O lembrete MUST NOT ser exceção à regra da feature 004 (FR-001): sem mensagem do cliente nas últimas 24 horas, nada é enviado automaticamente, e o horário MUST aparecer na aba de agendamentos como "lembrar manualmente".
- **FR-022a**: O operador MUST poder marcar pelo painel um horário como confirmado (por exemplo, depois de avisar o cliente por telefone); um horário confirmado MUST NOT receber lembrete automático.
- **FR-023**: Faltando menos de 2 horas para o horário sem que o lembrete tenha saído (cliente fora da janela, servidor desligado, fila ou pausa da proteção), o lembrete MUST ser descartado e registrado como não enviado, com o motivo.
- **FR-024**: A resposta YES ao lembrete MUST marcar o horário como confirmado pelo cliente e receber um agradecimento; pedidos de cancelar ou remarcar MUST seguir os fluxos que já existem.
- **FR-025**: Horários cancelados ou remarcados antes do lembrete MUST NOT receber o lembrete do horário antigo.
- **FR-026**: O envio do lembrete, a confirmação do cliente e o lembrete não enviado (com o motivo) MUST ficar registrados no histórico da conversa no painel.

### Key Entities

- **Agendamento** (existente, features 003 e 005): passa a ter a origem (assistente ou painel), a situação do lembrete (pendente, enviado, não enviado e o motivo) e a confirmação do cliente (confirmado ou não, e quando).
- **Cliente** (existente, feature 005): passa a ter anotações livres; o nome passa a poder ser editado pelo dono.
- **Lembrete**: o aviso enviado ao cliente cerca de 24 horas antes do horário; um por horário, ligado ao agendamento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O dono descobre quem vem hoje e amanhã, com serviço e telefone, sem sair do painel, em menos de 10 segundos a partir da abertura do painel.
- **SC-002**: A partir de um horário na aba de agendamentos ou da ficha do cliente, o dono chega à conversa daquele cliente com um clique.
- **SC-003**: Corrigir o nome de um cliente leva menos de 30 segundos e o nome novo aparece no painel, nas respostas do assistente e no título dos eventos futuros.
- **SC-004**: O operador marca pelo painel um horário para um cliente que ligou em menos de 1 minuto, e nenhum horário marcado pelo painel coincide com outro horário da agenda.
- **SC-005**: 100% dos horários com mais de 24 horas de antecedência terminam num destes estados antes do horário: lembrete enviado, confirmado pelo operador, ou não enviado com o motivo visível no painel (incluindo "lembrar manualmente"); nenhum fica sem situação.
- **SC-006**: Nenhum cliente recebe mais de um lembrete pelo mesmo horário, e nenhum lembrete é enviado para um horário cancelado, remarcado ou já passado.
- **SC-007**: A taxa de faltas da clínica cai depois de 30 dias de lembretes, medida pela clínica comparando com o mês anterior.

## Assumptions

- A aba de agendamentos mostra só os horários que o Secretaryfy conhece (marcados pelo assistente ou pelo painel); eventos criados direto no Google Agenda continuam só lá.
- "Semana" quer dizer os próximos 7 dias a partir de hoje, no fuso da clínica; horários mais distantes ficam fora desta lista.
- A aba de agendamentos é só de consulta: cancelar ou remarcar pelo painel fica fora do escopo desta feature (continua pelo WhatsApp ou direto no Google Agenda).
- O telefone do cliente não é editável na ficha: ele é a chave que liga o cliente à conversa e aos horários.
- As anotações são da clínica, não do cliente: ficam só no painel e nunca são lidas pelo assistente.
- Ao marcar pelo painel, o operador informa o serviço numa lista com os tratamentos da clínica e a avaliação geral, os mesmos do assistente; o horário respeita as regras de atendimento (dias, horas, antecedência mínima e máxima).
- Marcar pelo painel não manda mensagem ao cliente: ele combinou por telefone. O lembrete vale para esses horários nos mesmos termos: só sai se o cliente escrever pelo WhatsApp nas 24 horas anteriores; nos outros casos, o horário aparece como "lembrar manualmente".
- O lembrete sai em inglês, como as demais mensagens do assistente, e só existe para horários marcados depois desta feature.
- "Responda YES" vale enquanto o horário não passou; um YES depois do horário não muda nada.
- Um horário remarcado tem um lembrete próprio, contado a partir do horário novo.
- Não há segundo lembrete. O aviso ao operador é o destaque "lembrar manualmente" na aba de agendamentos, sem notificação fora do painel.
- Decisão do dono do produto (2026-10-25): o lembrete não abre exceção à regra de nunca escrever primeiro (feature 004 FR-001). Foi escolhida a opção de enviar só dentro da janela de 24 horas e destacar os demais horários para o operador, em vez de permitir o lembrete fora da janela.
