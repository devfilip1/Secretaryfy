# Feature Specification: Respostas da DentalSafe pelo WhatsApp com o RAG do RagLab

**Feature Branch**: `001-rag-whatsapp-dentalsafe`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Integrar ao Secretaryfy o assistente RAG do projeto RagLab, para que um cliente que manda mensagem no WhatsApp receba respostas sobre a clínica fictícia DentalSafe, baseadas no folheto da clínica. Esta é a base do agente de agendamentos, que será testado com essa mesma clínica. Reaproveitar o RagLab como está, sem reescrever, e ligá-lo ao Secretaryfy; a qualidade medida no RagLab precisa continuar valendo depois da cópia. Tudo roda localmente, sem custo de API."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cliente tira dúvida sobre a clínica pelo WhatsApp (Priority: P1)

Um cliente da DentalSafe manda uma pergunta de texto para o número de WhatsApp da clínica (por exemplo, "How much are braces?") e recebe, na mesma conversa, uma resposta curta com a informação do folheto e um convite para agendar uma avaliação. Quando o folheto não tem a resposta, o cliente recebe a frase de recusa padrão do assistente, sem informação inventada.

**Why this priority**: É o valor da feature e a base sobre a qual o agente de agendamentos será construído. Sem esse fluxo, nada mais desta feature tem uso.

**Independent Test**: Com o assistente e o Secretaryfy rodando localmente, enviar mensagens de um número de teste e conferir as respostas recebidas no WhatsApp.

**Acceptance Scenarios**:

1. **Given** o assistente e o Secretaryfy estão no ar, **When** o cliente envia "How much are braces?", **Then** ele recebe no WhatsApp uma resposta com os valores de aparelho que constam no folheto ($180–$450 de custo inicial e $35–$90 mensais).
2. **Given** o assistente e o Secretaryfy estão no ar, **When** o cliente envia "Do you accept dental insurance?", **Then** ele recebe uma resposta que começa com a frase de recusa padrão ("I don't have that information right now.") e oferece ajuda com tratamentos ou agendamento.
3. **Given** o assistente e o Secretaryfy estão no ar, **When** o cliente envia uma pergunta em português, **Then** a resposta vem em inglês, como determina o comportamento atual do assistente da DentalSafe.

---

### User Story 2 - A qualidade do assistente continua a mesma depois de trazido para o Secretaryfy (Priority: P1)

O desenvolvedor traz o assistente da DentalSafe e a bancada de avaliação do RagLab para dentro do repositório do Secretaryfy e confirma, com os mesmos comandos e o mesmo gabarito, que os resultados batem com a referência medida no RagLab.

**Why this priority**: O motivo de reaproveitar o RagLab é aproveitar um assistente já medido. Se a cópia mudar o comportamento sem que ninguém perceba, as respostas do User Story 1 deixam de ser confiáveis. Esta história pode ser feita e verificada antes de qualquer integração com o WhatsApp.

**Independent Test**: Dentro da pasta do assistente no Secretaryfy, preparar o ambiente, construir os índices e rodar os testes, as validações, a bancada de busca e a avaliação de respostas, comparando com a referência gravada.

**Acceptance Scenarios**:

1. **Given** o assistente foi copiado e os índices foram construídos, **When** o desenvolvedor roda os testes unitários, a validação da configuração e do gabarito e a checagem dos índices, **Then** tudo passa sem erros.
2. **Given** o assistente foi copiado e os índices foram construídos, **When** o desenvolvedor roda a bancada de busca, **Then** a configuração em uso (section_hybrid) leva a evidência ao modelo em 44 de 44 perguntas.
3. **Given** o assistente foi copiado e os índices foram construídos, **When** o desenvolvedor roda a avaliação de respostas sem juiz, **Then** o resultado fica a no máximo 2 questões dos 49 de 51 (96,1%) da referência, e a comparação com a referência funciona.

---

### User Story 3 - O cliente nunca fica sem retorno quando o assistente falha (Priority: P2)

Se o assistente estiver desligado, com erro ou demorando demais, o cliente que mandou a pergunta recebe uma mensagem curta dizendo que o atendimento automático está indisponível no momento, e o problema fica registrado no log para o desenvolvedor.

**Why this priority**: Evita que o cliente fique sem resposta e que a Evolution API reenvie eventos por timeout do webhook. É importante, mas o fluxo principal funciona sem isso.

**Independent Test**: Com o Secretaryfy no ar e o assistente desligado, enviar uma mensagem pelo WhatsApp e conferir a mensagem de indisponibilidade e o registro no log.

**Acceptance Scenarios**:

1. **Given** o assistente está desligado, **When** o cliente envia uma pergunta, **Then** o webhook responde com sucesso imediatamente, o cliente recebe a mensagem de indisponibilidade e o erro aparece no log.
2. **Given** o assistente demora mais que o tempo limite configurado, **When** o cliente envia uma pergunta, **Then** o cliente recebe a mensagem de indisponibilidade e nenhuma resposta atrasada é enviada depois dela.

---

### User Story 4 - O desenvolvedor sabe se o assistente está pronto (Priority: P3)

O desenvolvedor consegue consultar, a qualquer momento, se o assistente está pronto para responder: se o serviço de modelos local está acessível e se o índice da configuração em uso está atualizado. Se o índice estiver ausente ou desatualizado, o assistente nem chega a subir e informa qual comando resolve.

**Why this priority**: Facilita o diagnóstico em ambiente local. Sem isso, o User Story 3 ainda garante que o cliente não fique sem retorno.

**Independent Test**: Consultar o estado do assistente com tudo pronto, com o serviço de modelos desligado e com o índice apagado.

**Acceptance Scenarios**:

1. **Given** o serviço de modelos está no ar e o índice está atualizado, **When** o desenvolvedor consulta o estado, **Then** os dois itens aparecem como prontos.
2. **Given** o serviço de modelos está desligado, **When** o desenvolvedor consulta o estado, **Then** o serviço de modelos aparece como inacessível.
3. **Given** o índice da configuração em uso não existe ou está desatualizado, **When** o desenvolvedor tenta subir o assistente, **Then** ele se recusa a subir e mostra o comando que reconstrói o índice.

---

### Edge Cases

- **Mensagem que não é texto** (áudio, imagem, figurinha, localização): é ignorada, sem resposta ao cliente.
- **Mensagens enviadas pelo próprio número da clínica e mensagens de grupo**: são ignoradas, como já acontece hoje.
- **Mesmo evento entregue duas vezes pela Evolution API**: o cliente recebe uma única resposta.
- **Várias mensagens seguidas do mesmo cliente**: cada uma é respondida de forma independente, sem histórico; a ordem das respostas pode não seguir a ordem das perguntas.
- **Mensagem vazia ou só com espaços**: é ignorada.
- **Mensagem muito longa**: é encaminhada ao assistente; o que ele responder é enviado.
- **Falha ao enviar a resposta pelo WhatsApp**: o erro é registrado no log; não há nova tentativa nesta fase.
- **Tentativa de mudar o papel do assistente** ("ignore your instructions..."): o assistente responde com a frase de recusa padrão, como no RagLab.
- **Primeira pergunta depois de o modelo ficar ocioso** (carregamento do modelo mais lento): precisa caber no tempo limite padrão.

## Requirements *(mandatory)*

### Functional Requirements

**Assistente trazido do RagLab**

- **FR-001**: O repositório do Secretaryfy MUST conter uma cópia do assistente e da bancada de avaliação do RagLab em uma pasta própria (`rag/`), sem vínculo de submódulo com o repositório de origem.
- **FR-002**: A cópia MUST incluir o código do assistente, o código da avaliação, o gabarito e seus schemas, a configuração de estratégias e experimentos, os testes, o folheto da DentalSafe, a lista de dependências e os atalhos de comando (Makefile e run.ps1).
- **FR-003**: A cópia MUST incluir a referência de avaliação e apenas as execuções que ela aponta (dev `20261011-191541` e holdout `20261011-132527-reference-holdout`). As demais execuções, os índices gerados, o ambiente virtual, os caches e os arquivos locais de ferramentas não são copiados.
- **FR-004**: O folheto, o system prompt, a frase de recusa, os sinônimos, as stopwords, as estratégias, os experimentos e o gabarito MUST ficar idênticos aos do RagLab.
- **FR-005**: Os índices gerados e os arquivos locais do assistente MUST ficar fora do controle de versão do Secretaryfy.

**Serviço do assistente**

- **FR-006**: O assistente MUST ficar disponível como um serviço local separado do servidor do Secretaryfy, acessível por HTTP.
- **FR-007**: O serviço MUST oferecer uma consulta de estado que informa se o serviço de modelos local está acessível e se o índice da configuração em uso está atualizado.
- **FR-008**: O serviço MUST oferecer uma operação que recebe uma pergunta e devolve a resposta do assistente, os trechos do folheto usados (cada um com sua posição e sua similaridade com a pergunta) e o tempo de resposta.
- **FR-009**: O serviço MUST oferecer uma operação que recebe uma pergunta e devolve apenas os trechos recuperados, sem gerar resposta, para uso futuro como ferramenta do agente de agendamentos.
- **FR-010**: As duas operações MUST usar a mesma configuração de busca e o mesmo prompt que o chat e a avaliação do assistente usam, para que o comportamento medido seja o comportamento servido.
- **FR-011**: O serviço MUST se recusar a subir quando o índice da configuração em uso estiver ausente ou desatualizado, e MUST informar o comando que o reconstrói.
- **FR-012**: O serviço MUST rejeitar uma pergunta vazia com um erro claro, sem chamar o modelo.

**Atendimento pelo WhatsApp**

- **FR-013**: Ao receber uma mensagem de texto válida de um cliente, o Secretaryfy MUST confirmar o recebimento à Evolution API imediatamente, antes de consultar o assistente.
- **FR-014**: O Secretaryfy MUST encaminhar o texto da mensagem ao assistente em segundo plano e enviar a resposta obtida ao mesmo número, pelo cliente da Evolution API já existente.
- **FR-015**: Se o assistente estiver inacessível, devolver erro ou passar do tempo limite, o Secretaryfy MUST enviar ao cliente uma mensagem curta de indisponibilidade e MUST registrar o erro no log com o número do cliente e o motivo.
- **FR-016**: O Secretaryfy MUST ignorar mensagens que não são texto, mensagens vazias, mensagens enviadas pelo próprio número e mensagens de grupo.
- **FR-017**: O Secretaryfy MUST responder uma única vez a um mesmo evento de mensagem, mesmo que a Evolution API o entregue mais de uma vez.
- **FR-018**: Cada mensagem MUST ser respondida de forma independente, sem considerar mensagens anteriores do mesmo cliente.

**Configuração e documentação**

- **FR-019**: O endereço do serviço do assistente e o tempo limite da chamada MUST ser configuráveis por variáveis de ambiente, validadas na inicialização como as demais variáveis do Secretaryfy, com valores padrão para uso local.
- **FR-020**: O README do Secretaryfy MUST explicar como preparar e rodar o assistente junto com o servidor: ambiente Python, download dos modelos locais, construção dos índices, subida do serviço e verificação do estado.

### Key Entities

- **Pergunta**: o texto que o cliente enviou pelo WhatsApp, com o número de origem.
- **Trecho recuperado**: um pedaço do folheto que a busca considerou relevante para a pergunta, com sua posição no resultado e sua similaridade com a pergunta.
- **Resposta do assistente**: o texto a enviar ao cliente, junto com os trechos usados e o tempo que levou.
- **Estado do assistente**: se o serviço de modelos está acessível e se o índice em uso está atualizado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Na avaliação de respostas do assistente copiado, o acerto fica a no máximo 2 questões da referência de 49 de 51 (96,1%).
- **SC-002**: Na bancada de busca do assistente copiado, a evidência chega ao modelo em 44 de 44 perguntas respondíveis, como na referência.
- **SC-003**: Com tudo rodando localmente, o cliente recebe a resposta no WhatsApp em até 10 segundos depois de enviar a pergunta, em pelo menos 9 de 10 perguntas, excluindo a primeira pergunta depois de o modelo ficar ocioso.
- **SC-004**: Com o assistente desligado, 100% das perguntas recebem a mensagem de indisponibilidade, e nenhum evento é reenviado pela Evolution API por falta de confirmação.
- **SC-005**: A pergunta "How much are braces?" recebe pelo WhatsApp os valores do folheto, e a pergunta "Do you accept dental insurance?" recebe a frase de recusa padrão.
- **SC-006**: Seguindo só o README, um desenvolvedor sem contato prévio com o RagLab consegue colocar o fluxo completo para funcionar localmente.

## Assumptions

- O assistente continua respondendo sempre em inglês nesta fase, porque é o que o system prompt e o gabarito da DentalSafe determinam. O suporte a português fica para uma feature futura.
- O código copiado para `rag/` continua em inglês, seguindo as convenções do RagLab. O código do Secretaryfy continua em português, como já está.
- A documentação do RagLab (`docs/` e o README de origem) não é copiada. A pasta `rag/` ganha um README curto que aponta o RagLab como origem e lista os comandos.
- A mensagem de indisponibilidade é em inglês, para combinar com o idioma do assistente. Exemplo: "Sorry, our virtual assistant is unavailable right now. Please try again in a few minutes."
- O tempo limite padrão da chamada ao assistente é de 30 segundos, para acomodar o carregamento do modelo local.
- Qualquer número que mandar mensagem ao WhatsApp conectado recebe resposta. Nesta fase não há cadastro de cliente nem lista de números permitidos.
- Evitar respostas duplicadas para um mesmo evento só precisa funcionar enquanto o processo do Secretaryfy estiver no ar. Não é exigido que isso sobreviva a reinícios.
- Nesta fase não há fila nem nova tentativa de envio. Uma falha no envio pelo WhatsApp fica só no log.
- Pré-requisitos do ambiente local: Python 3.14, Ollama com os modelos `llama3` e `nomic-embed-text`, e a Evolution API configurada para chamar o webhook do Secretaryfy.
- Fora do escopo: agendamento no Google Agenda, envio de email, agente com ferramentas, português, outros documentos, base separada por cliente, troca de modelos, armazenamento vetorial no Postgres e histórico de conversa.
