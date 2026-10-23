# Contrato: textos ao cliente e registros no histórico — feature 004

Estende [specs/003-google-calendar-scheduling/contracts/conversation.md](../../003-google-calendar-scheduling/contracts/conversation.md). Os textos ao cliente continuam em inglês; os registros `system` do painel, em português.

## Palavras de saída e de volta (FR-019, FR-021)

Antes de comparar, a mensagem é normalizada:
- minúsculas;
- sem acentos;
- sem pontuação e emoji nas pontas;
- espaços repetidos viram um só.

Conta como saída ou volta só a mensagem **inteira** igual a um item da lista.

| Tipo | Lista |
|---|---|
| Saída | `parar`, `pare`, `para`, `sair`, `stop`, `unsubscribe`, `cancelar`, `cancelar mensagens`, `nao quero mais mensagens`, `nao quero receber mensagens`, `para de mandar mensagem`, `para de me mandar mensagem`, `remover`, `me remove`, `opt out`, `optout` |
| Volta | `voltar`, `start`, `quero voltar`, `ativar`, `subscribe` |

`cancelar` sozinho só conta como saída **fora** de um fluxo de agendamento. Com uma etapa em andamento (`scheduling_sessions`), ele continua indo para o agendamento, porque o cliente pode estar cancelando o horário.

## Textos ao cliente

Cada texto tem variações. O portão escolhe uma que não foi enviada àquele número nos últimos `ANTIBAN_DUPLICATE_WINDOW_MS` (research.md R6).

**Confirmação de saída**, enviada uma única vez:
- "Done — you won't receive any more messages from us here. If you change your mind, just reply START."
- "Understood. We'll stop messaging you on WhatsApp. Reply START anytime to talk to us again."
- "All set, no more messages from us. Should you need us again, reply START."

**Volta:**
- "Welcome back! How can we help you today?"
- "Great to hear from you again. How can we help?"

**Assistente indisponível**, que substitui o texto único da 001:
- "Sorry, our virtual assistant is unavailable right now. Please try again in a few minutes."
- "Our assistant is having trouble at the moment. Please send your message again shortly."
- "Apologies, I can't answer right now. Please try again in a little while."

## Registros `system` no histórico (painel, português)

| Quando | Texto |
|---|---|
| Cliente pediu para sair | `🚫 O cliente pediu para não receber mensagens` |
| Cliente voltou | `✅ O cliente voltou a aceitar mensagens` |
| Operador reativou | `✅ Mensagens reativadas pelo operador` |
| Laço detectado | `⚠️ Possível conversa com outro robô: o assistente foi pausado` |
| Limite diário de conversas | `⚠️ Limite diário de conversas atingido: o assistente não respondeu` |
| Resposta velha na fila | `⚠️ A resposta demorou demais na fila e não foi enviada` |
| Freio ativo | `⚠️ Envios automáticos pausados pela proteção: o assistente não respondeu` |

Os casos de laço, limite diário, fila velha e freio também destacam a conversa (`needs_attention`). O de laço pausa o assistente.
