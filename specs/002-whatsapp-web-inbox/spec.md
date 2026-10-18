# Feature Specification: Painel web do WhatsApp

**Feature Branch**: `002-whatsapp-web-inbox`

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description: "crie um site web para fazer a conexao com o whatsapp e acompanhar as conversas, deve aparecer as conversas e ter como visualizar e mandar mensagens"

## Contexto

Hoje o Secretaryfy responde automaticamente, com o assistente da DentalSafe, as mensagens de texto que chegam no WhatsApp conectado (feature 001). Ainda falta uma forma de conectar o número sem mexer direto na Evolution API, e nenhuma conversa fica guardada: depois que a resposta é enviada, não sobra registro de quem perguntou o quê nem do que o assistente respondeu.

Esta feature cria um painel web para o **operador**, a pessoa da clínica ou o desenvolvedor que acompanha o atendimento. Pelo painel ele conecta o WhatsApp, vê as conversas e manda mensagens.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acompanhar as conversas (Priority: P1)

O operador abre o painel e vê a lista de conversas, a mais recente primeiro. Cada uma mostra o nome ou número do cliente, a última mensagem e o horário. Ao abrir uma conversa, ele vê o histórico completo em ordem, com cada mensagem identificada pela origem: cliente, assistente automático ou operador. Quando chega uma mensagem nova ou o assistente responde, isso aparece no painel sem precisar recarregar a página.

**Why this priority**: É o motivo principal do painel. Sem ver as conversas, o operador não sabe o que o assistente está respondendo e não tem como intervir.

**Independent Test**: Com o WhatsApp já conectado, enviar mensagens de um número de teste e conferir que a conversa aparece no topo da lista, com a pergunta do cliente e a resposta do assistente, sem recarregar a página.

**Acceptance Scenarios**:

1. **Given** o painel aberto na lista de conversas, **When** um cliente novo manda "How much are braces?", **Then** em até 5 segundos aparece uma conversa nova no topo da lista, com o número do cliente e a mensagem.
2. **Given** a conversa aberta no painel, **When** o assistente responde o cliente, **Then** a resposta aparece no histórico identificada como do assistente, logo abaixo da pergunta.
3. **Given** várias conversas com mensagens em horários diferentes, **When** o operador abre o painel, **Then** as conversas aparecem ordenadas pela última mensagem, da mais recente para a mais antiga.
4. **Given** o cliente mandou um áudio ou uma imagem, **When** o operador abre a conversa, **Then** aparece no histórico um aviso do tipo de mídia recebida (ex.: "🎤 Áudio"), no lugar certo da sequência.
5. **Given** uma conversa com mensagens não lidas pelo operador, **When** ele olha a lista, **Then** a conversa mostra quantas mensagens não lidas tem, e a contagem zera quando ele a abre.

---

### User Story 2 - Mandar mensagens pelo painel (Priority: P1)

Com uma conversa aberta, o operador escreve um texto e envia. O cliente recebe a mensagem no WhatsApp, e ela aparece no histórico identificada como do operador.

**Why this priority**: Visualizar e mandar mensagens foram os dois pedidos explícitos. Sem o envio, o operador só observa e não consegue corrigir uma resposta errada do assistente nem atender um pedido que ele não resolve.

**Independent Test**: Abrir uma conversa existente, enviar um texto pelo painel e conferir que ele chega ao WhatsApp do número de teste e aparece no histórico.

**Acceptance Scenarios**:

1. **Given** uma conversa aberta, **When** o operador escreve "Olá, sou da recepção" e envia, **Then** o cliente recebe a mensagem no WhatsApp e ela aparece no histórico como do operador.
2. **Given** o WhatsApp desconectado, **When** o operador tenta enviar uma mensagem, **Then** o envio não acontece e o painel mostra que o WhatsApp está desconectado, mantendo o texto digitado.
3. **Given** a Evolution API recusa o envio, **When** o operador envia, **Then** a mensagem fica marcada no histórico como não enviada, com a opção de tentar de novo.
4. **Given** uma conversa aberta, **When** o operador tenta enviar um texto vazio, **Then** nada é enviado.

---

### User Story 3 - Conectar o WhatsApp pelo painel (Priority: P2)

O operador vê no painel se o WhatsApp está conectado e com qual número. Se não estiver, o painel mostra um QR code para ele escanear com o celular (WhatsApp > Aparelhos conectados). Quando a conexão é concluída, o status muda para conectado sem recarregar a página. Ele também pode desconectar o número.

**Why this priority**: Sem conexão não há conversas. Mas a conexão hoje já pode ser feita direto pela Evolution API, então as stories P1 funcionam sem esta.

**Independent Test**: Com o WhatsApp desconectado, abrir o painel, escanear o QR code com um celular de teste e conferir que o status muda para conectado com o número certo.

**Acceptance Scenarios**:

1. **Given** o WhatsApp desconectado, **When** o operador abre a tela de conexão, **Then** o painel mostra um QR code válido para escanear.
2. **Given** o QR code na tela, **When** ele expira sem ser escaneado, **Then** o painel mostra um QR code novo, sem o operador precisar fazer nada.
3. **Given** o QR code na tela, **When** o operador o escaneia com o celular, **Then** em até 10 segundos o painel mostra "conectado" e o número conectado.
4. **Given** o WhatsApp conectado, **When** o operador pede para desconectar e confirma, **Then** o número é desconectado e o painel volta a oferecer o QR code.
5. **Given** o WhatsApp conectado, **When** a conexão cai (por exemplo, o celular desconectou o aparelho), **Then** o painel mostra que o WhatsApp está desconectado, em qualquer tela.

---

### User Story 4 - Assumir a conversa no lugar do assistente (Priority: P2)

Numa conversa, o operador pausa o assistente automático para atender o cliente pessoalmente. Enquanto o assistente estiver pausado nessa conversa, as mensagens novas do cliente aparecem no painel, mas não recebem resposta automática. O operador pode reativar o assistente quando terminar.

**Why this priority**: Sem isso, quando o operador entra na conversa, o assistente continua respondendo junto com ele e o cliente recebe duas respostas, às vezes contraditórias. É importante, mas as stories P1 já entregam valor sem esta.

**Independent Test**: Pausar o assistente numa conversa, mandar uma pergunta do número de teste e conferir que ela aparece no painel sem resposta automática. Reativar e conferir que a próxima pergunta volta a ser respondida.

**Acceptance Scenarios**:

1. **Given** uma conversa com o assistente ativo, **When** o operador pausa o assistente e o cliente manda uma pergunta, **Then** a pergunta aparece no painel e o cliente não recebe resposta automática.
2. **Given** o assistente pausado numa conversa, **When** o operador o reativa e o cliente manda uma pergunta, **Then** o assistente volta a responder.
3. **Given** o assistente pausado na conversa A, **When** um cliente manda mensagem na conversa B, **Then** a conversa B continua com resposta automática.
4. **Given** uma conversa qualquer, **When** o operador olha o cabeçalho dela, **Then** vê se o assistente está ativo ou pausado.
5. **Given** uma conversa com o assistente ativo, **When** o operador envia uma mensagem pelo painel, **Then** o assistente é pausado automaticamente naquela conversa e continua pausado até o operador reativá-lo.

---

### User Story 5 - Só o operador acessa o painel (Priority: P1)

O painel pede login. Só quem tem acesso vê as conversas e manda mensagens. Quem não está logado é levado à tela de login, e o operador pode sair (logout).

**Why this priority**: O painel mostra conversas de clientes e envia mensagens em nome da clínica. Ele não pode ficar aberto para qualquer pessoa que descubra o endereço, e por isso é pré-requisito das outras stories.

**Independent Test**: Abrir o endereço do painel sem estar logado e conferir que nenhuma conversa aparece. Logar e conferir o acesso.

**Acceptance Scenarios**:

1. **Given** um visitante sem login, **When** ele abre qualquer página do painel, **Then** é levado à tela de login e não vê nenhuma conversa.
2. **Given** a tela de login, **When** o operador entra com as credenciais certas, **Then** chega à lista de conversas.
3. **Given** a tela de login, **When** alguém erra as credenciais, **Then** recebe uma mensagem genérica de erro, sem saber qual campo errou.
4. **Given** o operador logado, **When** ele sai, **Then** volta à tela de login e não acessa mais nada sem entrar de novo.
5. **Given** a configuração do servidor, **When** o operador define a senha de acesso, **Then** essa é a única credencial que abre o painel. Nesta fase existe um único acesso de operador, sem cadastro de usuários.

---

### Edge Cases

- **Mensagem do próprio celular**: o dono do número responde um cliente pelo app do WhatsApp no celular. A mensagem aparece na conversa, identificada como enviada pelo celular, e não é tratada como pergunta de cliente.
- **Mensagem do assistente ecoando como evento**: a resposta do assistente e a do operador voltam pela Evolution API como evento de mensagem enviada. Elas não podem aparecer duplicadas no histórico.
- **Mesmo evento entregue duas vezes**: aparece uma vez só no histórico.
- **Mensagens de grupo**: não aparecem no painel e continuam ignoradas pelo assistente.
- **Conversa com muitas mensagens**: o histórico abre rápido, mostrando as mais recentes primeiro e carregando as mais antigas conforme o operador rola para cima.
- **Mensagem longa ou com quebras de linha**: aparece inteira e com as quebras preservadas.
- **Dois navegadores abertos ao mesmo tempo**: os dois recebem as mensagens novas e o envio feito pelo outro.
- **Painel aberto enquanto o servidor reinicia**: o painel avisa que perdeu a conexão e se atualiza sozinho quando ela volta, sem perder mensagens recebidas nesse intervalo.
- **Cliente sem nome no WhatsApp**: a conversa mostra o número formatado.
- **Histórico de antes da feature**: conversas e mensagens anteriores à entrada desta feature não aparecem (ver Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Registro das conversas**

- **FR-001**: O sistema MUST guardar toda mensagem individual (não de grupo) recebida ou enviada pelo número conectado: texto, origem (cliente, assistente, operador ou celular), data e hora, e situação do envio.
- **FR-002**: O sistema MUST agrupar as mensagens em conversas, uma por número de cliente, guardando o nome que o cliente usa no WhatsApp quando houver.
- **FR-003**: Mensagens que não são texto MUST ser registradas com o tipo de mídia (áudio, imagem, vídeo, documento, figurinha, localização, contato), mesmo que o conteúdo não seja exibido.
- **FR-004**: O mesmo evento de mensagem MUST ser registrado uma única vez, inclusive o eco das mensagens que o próprio sistema enviou.
- **FR-005**: As respostas do assistente e as mensagens de indisponibilidade da feature 001 MUST ser registradas como mensagens do assistente.

**Visualização**

- **FR-006**: O painel MUST listar as conversas ordenadas pela última mensagem, mostrando nome ou número, prévia da última mensagem, horário e quantidade de mensagens não lidas.
- **FR-007**: O operador MUST conseguir abrir uma conversa e ver o histórico em ordem cronológica, com cada mensagem identificada pela origem e com data e hora.
- **FR-008**: Mensagens novas, recebidas ou enviadas por qualquer origem, MUST aparecer no painel aberto sem recarregar a página.
- **FR-009**: O operador MUST conseguir buscar uma conversa pelo nome ou pelo número do cliente.
- **FR-010**: Abrir uma conversa MUST zerar a contagem de não lidas dela.

**Envio**

- **FR-011**: O operador MUST conseguir enviar uma mensagem de texto para o cliente de uma conversa aberta.
- **FR-012**: Uma mensagem enviada pelo painel MUST aparecer no histórico como do operador, com a situação do envio (enviando, enviada, falhou).
- **FR-013**: Uma mensagem que falhou MUST poder ser reenviada pelo operador.
- **FR-014**: O painel MUST impedir o envio quando o WhatsApp estiver desconectado, avisando o operador e mantendo o texto digitado.

**Conexão do WhatsApp**

- **FR-015**: O painel MUST mostrar, em todas as telas, se o WhatsApp está conectado ou desconectado.
- **FR-016**: Com o WhatsApp desconectado, o painel MUST mostrar um QR code para conexão, renovado automaticamente quando expirar.
- **FR-017**: Ao concluir a conexão, o painel MUST mostrar o número conectado sem recarregar a página.
- **FR-018**: O operador MUST conseguir desconectar o número, com uma confirmação antes.
- **FR-019**: Ao conectar o número, o sistema MUST deixar o recebimento de mensagens configurado sem passos manuais na Evolution API.

**Assistente por conversa**

- **FR-020**: O operador MUST conseguir pausar e reativar o assistente automático em cada conversa.
- **FR-021**: Com o assistente pausado numa conversa, as mensagens do cliente MUST ser registradas e mostradas, mas não respondidas automaticamente.
- **FR-022**: O cabeçalho de cada conversa MUST mostrar se o assistente está ativo ou pausado.
- **FR-022a**: Enviar uma mensagem pelo painel MUST pausar automaticamente o assistente naquela conversa. Ele só volta a responder quando o operador o reativar.
- **FR-022b**: A resposta automática a uma mensagem do cliente que chegou antes da pausa, mas ainda não foi enviada, MUST ser descartada se a conversa for pausada nesse meio-tempo.

**Acesso**

- **FR-023**: O acesso ao painel MUST ser feito com uma única senha de operador, definida na configuração do servidor. Sem a senha definida, o painel não fica disponível.
- **FR-023a**: Todas as páginas e ações do painel MUST exigir login. Sem login, o visitante não vê conversas, status, QR code nem envia mensagens.
- **FR-024**: Credenciais erradas MUST receber uma mensagem genérica, e tentativas seguidas MUST ser limitadas para dificultar adivinhação.
- **FR-025**: O operador MUST conseguir sair, encerrando o acesso naquele navegador.

### Key Entities

- **Conversa**: uma por número de cliente. Guarda o número, o nome no WhatsApp, a última mensagem, a quantidade de não lidas e se o assistente está ativo ou pausado.
- **Mensagem**: pertence a uma conversa. Guarda o id da mensagem no WhatsApp, a origem (cliente, assistente, operador, celular), o tipo (texto ou mídia), o texto, a data e hora e a situação do envio.
- **Conexão do WhatsApp**: o estado atual (conectado, desconectado, aguardando QR code), o número conectado e o QR code em vigor.
- **Operador**: quem acessa o painel. Nesta fase é um único acesso, protegido por uma senha definida na configuração do servidor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma mensagem recebida aparece no painel aberto em até 5 segundos, sem recarregar a página.
- **SC-002**: Uma mensagem enviada pelo painel chega ao WhatsApp do cliente em até 5 segundos, com o WhatsApp conectado.
- **SC-003**: Um operador que nunca usou o painel consegue conectar o número pelo QR code em menos de 2 minutos.
- **SC-004**: 100% das mensagens individuais recebidas e enviadas durante um teste aparecem no histórico, sem duplicatas.
- **SC-005**: Com o assistente pausado numa conversa, 0 respostas automáticas são enviadas nela.
- **SC-006**: A lista de conversas e uma conversa com 500 mensagens abrem em até 2 segundos.
- **SC-007**: Sem login, nenhuma conversa, número de cliente ou QR code é acessível.

## Assumptions

- O painel é para uso interno da clínica ou do desenvolvedor, em português, e é usado no computador. Funcionar bem no celular é desejável, mas não obrigatório nesta fase.
- O painel faz parte do Secretaryfy e roda localmente, como o resto do projeto nesta fase.
- Há um único acesso de operador, sem cadastro de usuários. Por isso o histórico registra que uma mensagem veio "do operador", mas não de qual pessoa. Vários usuários com login próprio ficam para uma feature futura.
- A pausa do assistente numa conversa não expira sozinha: dura até o operador reativar.
- Há um único número de WhatsApp conectado por vez, o da instância já configurada no Secretaryfy.
- O histórico começa quando a feature entra no ar. Conversas anteriores, que já estão no celular, não são importadas.
- Mídias aparecem só como aviso do tipo (ex.: "🎤 Áudio"). Ver, ouvir ou baixar a mídia fica para depois, assim como enviar mídias pelo painel.
- As mensagens ficam guardadas sem prazo de expiração nesta fase.
- O operador escreve em português pelo painel. O assistente continua respondendo em inglês, como na feature 001.
- Fora do escopo: grupos, chamadas, status do WhatsApp, reações, mensagens apagadas ou editadas, confirmação de leitura do cliente (✓✓), vários números, distribuição de conversas entre vários operadores, e agendamento pelo Google Agenda.
