# Contract: interpretação da mensagem (delta da feature 005)

Completa o [contrato da feature 003](../../003-google-calendar-scheduling/contracts/interpreter.md). Módulo: `src/modules/scheduling/interpret.ts`.

## Entrada

```ts
type InterpretInput = {
  // ...campos da feature 003
  /** O assistente acabou de pedir o nome e esta é a primeira mensagem do cliente depois disso (R3) */
  awaitingName: boolean;
};
```

## Saída

```ts
type Interpretation = {
  // ...campos da feature 003, mais:
  intent: /* ... */ | "choose_service";
  /** Nome do catálogo (services.ts), quando intent = "choose_service" */
  service: string | null;
  /** Agora pode vir em qualquer intenção quando awaitingName (ex.: question + name) */
  name: string | null;
};
```

`"goodbye"` (das correções anteriores) continua existindo.

## Regras sem modelo (ordem de avaliação)

1. As da feature 003 para números, sim/não, datas e horários, nas etapas delas.
2. Etapa `choose_service`: número de 1 a 9 da lista → `choose_service` com o serviço; mensagem que cita um serviço do catálogo, ou "not sure"/"don't know" → `choose_service`. Qualquer outra → segue para o modelo.
3. Etapa `confirm_booking`: mensagem que cita um serviço do catálogo diferente do atual (e não é sim/não) → `choose_service`.
4. Despedida (`goodbye`), como já existe.
5. Em qualquer etapa: "my name is X", "my name's X", "call me X" → `give_name` com X.
6. Com `awaitingName`: "I'm X", "I am X", "it's X", "this is X", ou a mensagem inteira sendo um nome de 1 a 4 palavras, sem nenhuma palavra da lista de não-nomes → `give_name`.
7. Etapa `ask_name`: como na feature 003, agora também com a lista de não-nomes.

**Nome extraído**: sem pontuação nas pontas, espaços normalizados, cada palavra com a primeira letra maiúscula ("maria souza" → "Maria Souza"), no máximo 4 palavras e 60 caracteres. Acima disso, não é nome.

**Lista de não-nomes** (amostra): hi, hello, hey, why, what, how, who, no, yes, ok, okay, sure, thanks, thank, bye, please, help, price, cost, today, tomorrow, monday…sunday e todas as palavras do catálogo de serviços.

## Modelo

- Com `awaitingName`, o prompt de sistema ganha a linha: `The assistant has just asked the customer's name. If the message contains it, set "name".`
- Intenções novas no enum do JSON Schema: `choose_service` (com a descrição "picks the service/treatment for the appointment").
- `validate()`:
  - mantém `name` em qualquer intenção quando `awaitingName`; sem `awaitingName`, só em `give_name` e `book` (como hoje);
  - aplica ao `name` as mesmas regras de nome extraído; inválido vira `null` (e `give_name` sem nome vira `unclear`);
  - `choose_service` só vale com um serviço do catálogo; senão vira `unclear`.
