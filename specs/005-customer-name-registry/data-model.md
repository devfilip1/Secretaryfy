# Data Model: Nome do cliente, cadastro de clientes e serviço no agendamento

Mudanças no banco: uma migration gerada pelo Drizzle (`npm run db:generate`), `drizzle/0005_customers.sql`. Decisões em [research.md](research.md).

## Nova tabela `customers` (cadastro de clientes)

Quem já confirmou ao menos um horário. Não depende das conversas: apagar conversas ou desconectar o número não a apaga (FR-019).

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | uuid, PK, `defaultRandom()` | Identificador do cliente (FR-015) |
| `phone` | text, not null, **unique** | Mesmo formato de `conversations.phone` (só dígitos, com DDI). Um registro por número (FR-016) |
| `name` | text, not null | Último nome informado num agendamento confirmado (FR-017) |
| `created_at` | timestamptz, not null, `defaultNow()` | Quando entrou no cadastro |
| `updated_at` | timestamptz, not null, `defaultNow()` | Última atualização do nome |

**Escrita**: só em `book()` (fluxo de agendamento), depois do evento criado no Google e do `appointments` gravado. `insert … on conflict (phone) do update set name = excluded.name, updated_at = now()` (R5). Nenhum outro caminho grava aqui.

**Leitura**: `findByPhone(phone)`, para o nome conhecido (R1) e para ligar o agendamento ao cliente.

## `conversations` (alterada)

| Coluna nova | Tipo | Regras |
|---|---|---|
| `customer_name` | text, null | Nome que o cliente disse na conversa (FR-003). Nunca vem do perfil do WhatsApp. Uma correção substitui o valor |
| `name_asked_at` | timestamptz, null | Quando o assistente pediu o nome fora do agendamento. Preenchida uma vez; impede pedir de novo (FR-005) |

`name` continua sendo o nome do perfil do WhatsApp (`pushName`), atualizado a cada mensagem.

**Nome conhecido** (derivado, não é coluna): `customer_name` → `customers.name` pelo telefone → nenhum. O nome do perfil não entra.

**Aguardando o nome** (derivado): sem nome conhecido, `name_asked_at` preenchida e nenhuma mensagem do cliente com `sent_at > name_asked_at` além da mensagem atual (R3).

## `scheduling_sessions` (alterada)

| Coluna nova | Tipo | Regras |
|---|---|---|
| `service` | text, null | Serviço escolhido até aqui: um nome do catálogo (R4). Passa de etapa em etapa, como `customer_name` |

`SessionOption` ganha um terceiro tipo para a lista de serviços:

```ts
type SessionOption =
  | { n: number; kind: "day"; date: string }
  | { n: number; kind: "slot"; start: string }
  | { n: number; kind: "service"; service: string };
```

Enum `scheduling_step` ganha o valor `choose_service` (`ALTER TYPE … ADD VALUE`, como o `blocked` da migration 0004).

## `appointments` (alterada)

| Coluna nova | Tipo | Regras |
|---|---|---|
| `service` | text, null | Serviço do agendamento. Nulo só nos agendamentos anteriores a esta feature |
| `customer_id` | uuid, null, FK → `customers.id`, `on delete set null` | Cliente do cadastro. Preenchido logo depois do upsert do cliente |

## Catálogo de serviços (código, não tabela)

`src/modules/scheduling/services.ts`. Ordem da lista numerada = ordem do folheto.

| # | Serviço (texto no evento) | Palavras que o identificam na conversa |
|---|---|---|
| 1 | Dental Cleaning | clean, cleaning, prophylaxis, tartar, plaque |
| 2 | Teeth Whitening | whitening, whiten, whiter, bleach, bleaching |
| 3 | Dental Filling | filling, fillings, cavity, cavities, decay |
| 4 | Root Canal Treatment | root canal, endodontic |
| 5 | Dental Implants | implant, implants |
| 6 | Braces and Orthodontic Treatment | braces, aligners, invisalign, orthodontic, orthodontics, straighten, crooked |
| 7 | Tooth Extraction | extraction, extract, pull, pulled, wisdom |
| 8 | Dental Veneers | veneer, veneers |
| 9 | Assessment | not sure, don't know, dont know, no idea, assessment, check-up, checkup, evaluation |

Comparação sem acentos e sem caixa, por palavra inteira. Quando a conversa cita mais de um, vale o citado por último (Edge Cases: "registra o principal").

## Transições do agendamento (delta sobre a feature 003)

```text
choose_slot ──(escolheu horário)──► [sem nome conhecido]  ask_name
                                   [sem serviço]          choose_service
                                   [com nome e serviço]   confirm_booking
ask_name ──(give_name)──► [sem serviço] choose_service │ [com serviço] confirm_booking
choose_service ──(escolheu serviço / "not sure")──► confirm_booking
confirm_booking ──(citou outro serviço)──► confirm_booking (resumo de novo, serviço trocado)
confirm_booking ──(yes)──► evento criado → appointments → customers (upsert) → fim
```

O serviço inicial da sessão é o `mentionedService` do roteador (R4), gravado em `scheduling_sessions.service` ao sair de `choose_slot`. No fluxo de remarcar nada muda: o evento é movido e mantém o título.
