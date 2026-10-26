# Contract: API do painel (delta da feature 005)

> **Atualizado pela feature 006:** `GET /api/customers` passa a trazer `notes` e `conversationId`, e há `PATCH /api/customers/:id` para editar nome e anotações. Ver [specs/006 contracts/panel-api.md](../../006-panel-appointments-reminders/contracts/panel-api.md).

Nenhuma rota nova e nenhum campo novo. Muda só o valor de um campo e a busca.

## `ConversationJson.name`

Em `GET /api/conversations`, `GET /api/conversations/:id/messages`, `PATCH /api/conversations/:id` e no evento `conversation.updated`:

| Antes | Agora |
|---|---|
| Nome do perfil do WhatsApp (`pushName`) | Nome dito pelo cliente (`customer_name`), ou o do perfil quando o cliente ainda não disse (FR-008) |

Quando o cliente diz o nome, o painel recebe `conversation.updated` com o nome novo.

## `GET /api/conversations?q=`

A busca procura no nome dito, no nome do perfil e no telefone.

## Fora do escopo

Não há rota para listar ou editar o cadastro de clientes (Assumptions da spec).
