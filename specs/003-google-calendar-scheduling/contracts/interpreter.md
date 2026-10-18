# Contract: interpretação da mensagem do cliente

Como uma mensagem de texto vira uma intenção estruturada ([research.md R1](../research.md#r1-como-o-modelo-local-conduz-o-agendamento)). Módulo: `src/modules/scheduling/interpret.ts`.

## Saída

```ts
type Interpretation = {
  intent:
    | "book"            // quer marcar
    | "availability"    // quer saber dias ou horários livres, sem pedir para marcar
    | "cancel"
    | "reschedule"
    | "my_appointment"  // quando é o meu horário?
    | "choose"          // escolheu uma das opções oferecidas
    | "more"            // quer ver mais opções
    | "other_day"       // quer outro dia
    | "yes"
    | "no"
    | "give_name"
    | "stop"            // desistiu do agendamento
    | "question"        // dúvida sobre a clínica (vai para o RAG)
    | "unclear";
  option: number | null; // número da opção, quando intent = "choose"
  date: string | null;   // YYYY-MM-DD no fuso da clínica, quando o cliente citou um dia
  name: string | null;   // quando intent = "give_name" ou o nome veio junto
  source: "rule" | "model";
};
```

## 1. Regras (sem modelo)

Avaliadas antes, na etapa atual da sessão. Se uma casar, o modelo não é chamado.

| Etapa | Mensagem (sem diferenciar maiúsculas, com pontuação removida) | Resultado |
|---|---|---|
| `choose_day`, `choose_slot` | Só um número de 1 até o tamanho de `options` | `choose`, `option = n` |
| `choose_day`, `choose_slot` | Número fora da lista | `unclear` |
| `choose_slot` | `more`, `more options`, `others` | `more` |
| `choose_slot` | Um horário citado na frase (`10 am`, `2:30 pm`, `14:00`) que esteja entre as opções | `choose`, `option` dessa opção |
| `choose_day`, `choose_slot` | `other day`, `another day`, `different day` | `other_day` |
| `confirm_*`, `offer_reschedule` | `yes`, `y`, `yeah`, `yep`, `sure`, `ok`, `okay`, `confirm`, `correct`, `sim` | `yes` |
| `confirm_*`, `offer_reschedule` | `no`, `n`, `nope`, `not`, `nao`, `não` | `no` |
| Qualquer | `today`, `tomorrow`, `monday`…`sunday`, `next <dia>`, `dd/mm`, `<Mon> <dd>`, `<dd> <Mon>` sozinhos | Em etapa de dia ou horário: `choose` do dia → `date`. Sem etapa: `availability` com `date` |
| `ask_name` | 1 a 4 palavras só com letras | `give_name`, `name` |

Datas: `next friday` é a sexta da semana seguinte; `friday` é a próxima sexta contando hoje (se hoje for sexta e não houver vaga, o fluxo oferece os dias mais próximos). Datas sem ano usam o ano que deixa a data no futuro.

## 2. Modelo (Ollama)

`POST {OLLAMA_URL}/api/chat`:

```json
{
  "model": "llama3",
  "stream": false,
  "keep_alive": "30m",
  "options": { "temperature": 0 },
  "format": { "type": "object", "properties": { "intent": { "enum": ["book", "..."] }, "option": { "type": ["integer", "null"] }, "date": { "type": ["string", "null"] }, "name": { "type": ["string", "null"] } }, "required": ["intent", "option", "date", "name"] },
  "messages": [
    { "role": "system", "content": "<instruções fixas + hoje: Tuesday 2026-10-20, fuso America/Bahia + etapa atual + opções numeradas oferecidas>" },
    { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." },
    { "role": "user", "content": "<mensagem atual>" }
  ]
}
```

- **Histórico**: as últimas 20 mensagens de texto da conversa, sem as `system` ([research.md R5](../research.md#r5-contexto-da-conversa-para-o-modelo)).
- **Instruções**: classificar, não responder; usar só as intenções listadas; converter datas relativas usando a data de hoje informada; `option` só se citar uma opção da lista; na dúvida, `unclear`.
- **Tempo limite**: `AGENT_TIMEOUT_MS` (padrão 20 s).

## 3. Validação

A resposta passa por zod. Antes da validação, se a frase cita **exatamente uma** data simples (as mesmas formas da tabela acima, em qualquer posição: "openings on Sunday?"), essa data substitui a do modelo nas intenções `book`, `availability`, `choose` e `reschedule`: o `llama3` erra dias da semana.

Vira `unclear`:
- JSON inválido ou intenção fora da lista;
- `option` fora de `1..options.length`;
- `date` inválida, no passado ou além de `max_days_ahead` (o fluxo explica o limite, Edge Case "pedido muito distante", e isso **não** conta como "não entendi");
- `choose` sem `option` nem `date`.

Ollama fora do ar ou tempo estourado: `InterpreterUnavailable` (tratado pelo roteador, [research.md R3](../research.md#r3-quando-a-mensagem-vai-para-o-agendamento-ou-para-o-folheto)).
