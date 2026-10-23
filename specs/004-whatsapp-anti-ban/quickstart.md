# Quickstart: validar a proteção do número (anti-ban)

Roteiro de validação ponta a ponta, sem segundo número. O simulador da feature 003 envia ao webhook uma mensagem de cliente com o próprio número conectado, e a resposta chega no chat "Você" do WhatsApp.

## Pré-requisitos

- `docker compose up -d`: Postgres, Redis e Evolution v2.3.7.
- `npm run db:migrate`: aplica a `drizzle/0004_antiban.sql`.
- `npm run dev` e `npm run dev:web`, painel logado e WhatsApp conectado.
- Para os cenários de limite, baixe os valores no `.env` e reinicie o servidor:

  ```
  ANTIBAN_PER_MINUTE=2
  ANTIBAN_CONVERSATIONS_PER_DAY=2
  ANTIBAN_BREAKER_FAILURES=2
  ANTIBAN_WARMUP_DAYS=0
  ```

Atalho usado abaixo:

```powershell
function say($text, $phone) { npx tsx --env-file=.env scripts/simulate-customer.ts $text @(if ($phone) { "--phone", $phone }) }
```

## §1 — Chamadas da Evolution (contracts/evolution.md)

1. `say "What are your opening hours?"`
2. **Esperado:** no celular, a mensagem do chat "Você" fica lida, aparece "digitando…" por alguns segundos e a resposta chega sem prévia de link.
3. Se a marcação de lida falhar, o log mostra `warn` com o endpoint. Confirme o nome certo em `http://localhost:8080/docs` e ajuste só `evolution.ts`.

## §2 — Ritmo e mensagens seguidas (US1; FR-005 a FR-008)

1. Rode em sequência rápida: `say "hi"`, `say "how are you?"`, `say "what are your opening hours?"`.
2. **Esperado:** uma única resposta, uns 4 s depois da última mensagem.
3. Repita a mesma pergunta duas vezes, com 1 minuto entre elas.
4. **Esperado:** o tempo de "digitando…" é diferente nas duas vezes, e o log `envio liberado` mostra `typing_ms` diferentes.

## §3 — Limite por minuto e fila (FR-009, FR-010, FR-012)

1. Com `ANTIBAN_PER_MINUTE=2`, simule três clientes: `say "hours?" 5511900000001`, depois `…02` e `…03`.
2. **Esperado:**
   - duas respostas saem no primeiro minuto e a terceira espera; o painel mostra as três em `sending` até saírem;
   - `GET /api/protection` mostra `usage.lastMinute` = 2 durante a espera.
3. Com `ANTIBAN_QUEUE_MAX_AGE_MS=5000`, repita o passo 1.
4. **Esperado:** a terceira resposta vira `Não enviada pela proteção: Ficou tempo demais na fila`, e a conversa fica destacada.

## §4 — Laço e insistência (US2; FR-013 a FR-016)

1. Os testes automatizados cobrem o laço: `npm test -- --test-name-pattern="assessConversation"`.
2. Ao vivo: `say "hours?"` duas vezes seguidas, antes de a primeira resposta sair.
3. **Esperado:** se o texto da resposta for idêntico, a segunda vira `Não enviada pela proteção: Texto repetido`.

## §5 — Pedido de saída (US3; FR-019 a FR-022)

1. `say "STOP"`
2. **Esperado:**
   - uma confirmação em inglês;
   - o painel mostra a conversa como "não quer receber mensagens", com o registro `🚫` no histórico.
3. `say "What are your opening hours?"`
4. **Esperado:** a mensagem aparece no painel e nenhuma resposta sai.
5. `say "não quero parar o tratamento"`
6. **Esperado:** nada muda. Não é um pedido de saída nem de volta.
7. `say "START"`
8. **Esperado:** a mensagem de volta, e o assistente passa a responder.
9. Desconecte e reconecte o WhatsApp pelo painel, mande `say "STOP"` e depois outra mensagem.
10. **Esperado:** a preferência continua valendo, mesmo com as conversas apagadas.

## §6 — Operador fora da janela de 24 h (US4; FR-002)

1. No banco, deixe a última mensagem do cliente com mais de 24 h:

   ```sql
   update messages set sent_at = now() - interval '25 hours' where origin = 'customer';
   ```

2. Tente enviar pelo painel.
3. **Esperado:**
   - o diálogo de risco aparece com "O cliente não escreve há mais de 24 horas";
   - cancelar não envia nada; confirmar envia;
   - sem o painel: `POST /api/conversations/:id/messages` sem `confirmRisk` responde `409 risk_confirmation_required`.

## §7 — Freio automático (US5; FR-025 a FR-028)

1. Com `ANTIBAN_BREAKER_FAILURES=2`, pare a Evolution (`docker compose stop evolution`) e mande duas mensagens pelo painel, confirmando o risco.
2. **Esperado:**
   - as duas falham;
   - o painel mostra a faixa "Envios automáticos pausados" com o horário de retomada (em até 5 s, SC-006);
   - `GET /api/protection` responde `state: "paused"`.
3. `docker compose start evolution` e `say "hours?"`
4. **Esperado:** nenhuma resposta, e a conversa fica destacada com `Envios automáticos pausados pela proteção`.
5. Reenviar a mesma mensagem duas vezes em menos de 30 s
6. **Esperado:** o segundo pedido responde `429 retry_too_soon`.
7. Para não esperar 30 min:

   ```sql
   update protection_state set paused_until = now() - interval '1 second';
   ```

8. **Esperado:** a faixa some na próxima consulta, e os envios voltam.

## §8 — Aquecimento e limite diário (US6; FR-011, FR-023, FR-024)

1. Com `ANTIBAN_WARMUP_DAYS=14`, desconecte e apague o número para que conte como novo:

   ```sql
   delete from connected_numbers;
   ```

   Depois, reconecte.
2. **Esperado:**
   - o painel mostra "Número em aquecimento até <data>";
   - `limits.conversationsPerDay` mostra 30.
3. Com `ANTIBAN_WARMUP_CONVERSATIONS_PER_DAY=2`, simule três números diferentes.
4. **Esperado:** o terceiro não recebe resposta e fica destacado com `Limite diário de conversas atingido`. Um quarto envio de um dos dois primeiros números continua sendo respondido.

## §9 — Tentativas de QR (FR-029)

1. Desconectado, peça QR code seis vezes seguidas pelo painel.
2. **Esperado:** a sexta responde `429 too_many_attempts`, e o painel mostra quando pode tentar de novo.

## Verificação automatizada

```powershell
npm run typecheck
npm test
```

Os testes cobrem, sem rede:
- as funções puras: digitação, links, palavras de saída, `assessConversation` e rampa de aquecimento;
- a fila com relógio falso;
- o portão com repositório de teste;
- as rotas novas e alteradas.
