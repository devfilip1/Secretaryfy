# Contract: evento no Google Agenda (delta da feature 005)

Completa o [contrato da feature 003](../../003-google-calendar-scheduling/contracts/google-calendar.md). Só muda o conteúdo do evento criado em `book()` (`src/modules/scheduling/flow.ts`); as chamadas à API não mudam.

## Evento criado ao confirmar

| Campo | Antes (003) | Agora (005) |
|---|---|---|
| `summary` | `Avaliação — {nome}` | `{nome} — {serviço}` (FR-013) |
| `description` | `WhatsApp: +{phone}`<br>`Marcado pelo Secretaryfy.` | `WhatsApp: +{phone}`<br>`Serviço: {serviço}`<br>`Marcado pelo Secretaryfy.` |

- `{nome}`: o nome conhecido no momento da confirmação (o do resumo). Nunca o nome do perfil do WhatsApp.
- `{serviço}`: o texto do catálogo, em inglês ("Dental Cleaning", "Assessment").
- Exemplo: `Maria Souza — Dental Cleaning`.

## Remarcar

`moveEvent` só muda início e fim: título e descrição continuam os da marcação (FR-014).

## Agendamentos anteriores

Eventos criados antes desta feature continuam com o título antigo; nada é reescrito.
