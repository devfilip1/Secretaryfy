# Research: Nome do cliente, cadastro de clientes e serviço no agendamento

Decisões da Fase 0. Cada uma parte do código atual (features 001 a 004) e do que a [spec](spec.md) pede.

## R1. Onde fica o nome dito pelo cliente

**Situação atual**: `conversations.name` guarda o nome do **perfil do WhatsApp** (`pushName`), regravado a cada mensagem recebida (`upsertConversation`, `coalesce(excluded.name, name)`). O agendamento usa esse campo (`flow.ts`, `selectSlot`): se o perfil tem nome, o assistente nem pergunta. Por isso a conversa do print aparece como "." e o evento sairia "Avaliação — .".

**Decision**: nova coluna `conversations.customer_name`, só com o nome que o cliente disse na conversa, separada de `name`, que continua sendo o do perfil. O **nome conhecido** de um número é, nesta ordem: `conversations.customer_name` → `customers.name` (cadastro, R5). O nome do perfil não conta como nome conhecido: não evita a pergunta do nome nem vai para o evento.

**Rationale**: o `pushName` é sobrescrito a cada mensagem e muitas vezes não é um nome ("." , emoji, apelido). Misturar os dois faria o nome dito ser apagado pela próxima mensagem. A spec pede que valha o nome dito (Edge Cases) e que o painel o mostre (FR-008).

**Alternatives considered**:
- Gravar o nome dito em `conversations.name`: seria sobrescrito pelo `pushName` na mensagem seguinte.
- Guardar o nome dito direto no cadastro de clientes: contraria a spec, que só cadastra quem confirmou um horário (FR-015, FR-018).
- Uma tabela de contatos por telefone, fora das conversas: duplicaria o cadastro sem necessidade; quem não marcou e teve a conversa apagada simplesmente volta a ser perguntado, o que é aceitável.

## R2. Quando e como o assistente pede o nome

**Decision**:
- O pedido é um **texto fixo** do código (com variações), não escrito pelo modelo, mandado como **última mensagem** da resposta: "By the way, may I have your name?". Assim SC-001 é verificável e o texto nunca some numa resposta mal formada do llama3.
- Vai junto da primeira resposta do **folheto** (dúvidas e saudações) quando o número não tem nome conhecido e o nome ainda não foi pedido nesta conversa. A coluna `conversations.name_asked_at` registra o pedido e impede que ele se repita (FR-005).
- Não vai junto de despedidas nem de respostas do agendamento: se a primeira mensagem já é "I want to book", o fluxo pede o nome na etapa dele (`ask_name`), como hoje.
- `Reply` ganha `followUp?: string`: a mensagem extra que sai depois das partes da resposta. O envio divide a resposta em no máximo `MAX_PARTS − 1` partes quando há `followUp`, para o total continuar em 3 mensagens (abaixo de `ANTIBAN_MAX_UNANSWERED=3`).

**Rationale**: o roteador já decide entre folheto, agendamento e despedida, então é o lugar natural de anexar o pedido. Mandar como mensagem separada lê como uma pessoa ("Teeth whitening costs $180–$450." / "By the way, may I have your name?").

**Alternatives considered**:
- Pedir pelo prompt do RAG: o llama3 não segue regras de forma confiável (visto na correção do "Hi!" repetido), e o RAG não sabe se o nome já é conhecido.
- Responder só "What's your name?" e segurar a pergunta do cliente: contraria FR-002.

## R3. Como reconhecer o nome na resposta do cliente

**Decision**: o interpretador (`interpret.ts`) recebe `awaitingName: boolean` = o nome foi pedido (`name_asked_at`) e esta é a **primeira** mensagem do cliente depois do pedido, ainda sem nome conhecido.
- Regras, sem modelo:
  - "my name is X" / "my name's X" / "call me X": em qualquer momento → `give_name`.
  - Com `awaitingName`: "I'm X", "I am X", "it's X", "this is X", ou a mensagem inteira sendo um nome (regex `NAME` que já existe) → `give_name`.
  - A mensagem inteira só vale como nome se nenhuma palavra estiver numa lista de palavras comuns que não são nome (hi, hello, why, what, no, yes, ok, thanks, sure, braces, cleaning…). Isso cobre FR-004.
- Modelo: com `awaitingName`, o prompt diz que o assistente acabou de pedir o nome. Ele pode devolver `give_name`, ou outra intenção com `name` preenchido ("I'm Maria, how much is whitening?" → `question` + `name: "Maria"`). `validate()` passa a aceitar `name` em qualquer intenção quando `awaitingName`.
- Sem etapa de agendamento, `give_name` grava `customer_name` e responde com texto fixo ("Nice to meet you, Maria! How can I help you?"). Nome junto de uma pergunta é gravado e a pergunta segue para o folheto.
- Correção ("actually it's Mariana") cai em "my name is"/modelo com nome e substitui o nome conhecido.

**Rationale**: limitar a leitura "mensagem inteira = nome" à mensagem logo depois do pedido evita que "Braces" ou "Friday" virem nome mais tarde. As regras resolvem os casos comuns sem custo de modelo, como no resto do interpretador.

**Alternatives considered**: estado explícito "aguardando nome" em `scheduling_sessions`: a sessão é do agendamento, expira em 30 min e é apagada ao terminar. Derivar de `name_asked_at` + mensagens posteriores não precisa de estado novo.

## R4. Como o serviço é escolhido

**Decision**:
- **Catálogo fixo** no Node (`src/modules/scheduling/services.ts`): os 8 tratamentos do folheto com o nome em inglês, como no folheto, e palavras que os identificam (ex.: Dental Cleaning ← clean, cleaning; Braces and Orthodontic Treatment ← braces, aligners, invisalign, orthodontic, straighten; Tooth Extraction ← extraction, extract, pull, wisdom), mais "Assessment" (avaliação geral).
- **Detecção pela conversa**: o roteador procura o tratamento citado por último nas mensagens do cliente (histórico + mensagem atual) e passa como `mentionedService` para o fluxo. Sem modelo.
- **Nova etapa `choose_service`** no fluxo, depois do horário e do nome, antes do resumo, só quando não há serviço citado. Lista numerada dos 8 tratamentos + "9. Not sure — general assessment". Responder com número, com o nome do tratamento ("whitening") ou com "not sure"/"I don't know" resolve a etapa.
- **Troca no resumo**: na etapa `confirm_booking`, uma mensagem que cite outro tratamento troca o serviço e mostra o resumo de novo (FR-012).
- Pedido de serviço fora do catálogo: a etapa repete a lista (conta como "não entendi" da etapa, com o limite de 2 da feature 003).

**Rationale**: o fluxo da feature 003 é uma máquina de estados determinística com textos fixos, e o serviço escolhido vai para a agenda: não pode depender de o modelo inventar um nome de tratamento. O folheto muda raramente, e um teste confere o catálogo contra os títulos das seções do índice do RAG.

**Alternatives considered**:
- Ler os tratamentos do índice do RAG por um endpoint novo: os títulos têm slogans e seções que não são tratamentos ("Why Choose DentalSafe?"); o filtro seria frágil e criaria dependência do serviço Python para marcar horário.
- Perguntar o serviço antes dos dias: atrasa o caminho de quem só quer marcar a avaliação e muda a abertura do fluxo da 003, que já está validada.
- O modelo extrair o serviço: menos previsível e mais lento que palavras-chave para 8 itens.

## R5. Cadastro de clientes

**Decision**: tabela `customers` (`id` uuid, `phone` único, `name`, `created_at`, `updated_at`), **sem chave estrangeira** para `conversations`, para sobreviver ao botão de apagar conversas e à desconexão (FR-019). Gravada no `book()` do fluxo **depois** de `insertBooked` dar certo, com `insert … on conflict (phone) do update set name, updated_at` (FR-015 a FR-017). `appointments` ganha `customer_id` (FK para `customers`, `on delete set null`) e `service`.

**Rationale**: o telefone já é a identidade do cliente em todo o sistema (`conversations.phone`, `contact_preferences.phone`). Gravar só depois do evento criado e do agendamento gravado garante FR-018. O upsert numa instrução resolve dois agendamentos simultâneos do mesmo número.

**Alternatives considered**: gravar dentro de uma transação com o agendamento: o evento do Google não participa da transação de qualquer forma, e a falha do upsert depois de marcado não deve desfazer a marcação (fica no log e o cliente é incluído no próximo agendamento).

## R6. Título e descrição do evento

**Decision**: `summary` = `"<nome> — <serviço>"` (ex.: "Maria Souza — Dental Cleaning"); `description` continua com o WhatsApp e passa a citar o serviço. Remarcar usa `moveEvent`, que não mexe no título (FR-014). O registro `system` do painel passa a citar o serviço ("📅 Agendado pelo assistente: seg, 26/10 às 13:00 (30 min) — Dental Cleaning").

**Rationale**: é o formato pedido e o que a equipe lê de relance na agenda. O nome vem antes porque a agenda corta títulos longos na visão de semana.

## R7. Nome no painel

**Decision**: a conversa apresentada ao painel usa `customer_name ?? name` no campo `name` (o JSON não muda de forma); a busca do painel procura nos dois. Quando um número com cadastro volta a conversar e a conversa ainda não tem `customer_name`, o roteador copia o nome do cadastro para a conversa.

**Rationale**: o painel e o contrato da API não precisam mudar de forma; só o valor exibido passa a ser o nome dito.

## R8. O que não muda

- O RAG em Python (`rag/`) não muda: o pedido de nome é anexado pelo Node, e o assistente não precisa do nome do cliente para responder dúvidas (FR-006 diz MAY).
- Agendamentos já existentes ficam como estão (`service` nulo, sem `customer_id`); não há migração de eventos nem cadastro retroativo.
