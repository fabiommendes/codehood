---
type: issue
status: todo
tags: [observability, performance, services]
relatedTo: [metricas-de-performance-no-servidor, teste-de-carga-da-prova]
kind: enhancement
priority: high
created: 2026-11-13
creator: claude
---

# Registrar no log as chamadas lentas de services

## Problema

Não há como saber qual operação deixou o servidor lento na `teste2-elm`
(2026-11-13, ver `metricas-de-performance-no-servidor.md`). Todo service passa
por `defineService` (`src/db/define-service.ts`), que é um ponto único para
medir o tempo de cada chamada. Medir ali custa duas leituras de
`performance.now()` por chamada, e só escreve no log quando a chamada passa de
um limiar. Em operação normal, não há I/O nenhum.

## Proposta

- **Nome explícito por service:** `defineService<FooT>("foo")(...)`. Os `op`
  são funções anônimas, e o nome do arquivo na stack não serve: depois do
  build, o Vite renomeia e junta os módulos em chunks. O argumento é
  obrigatório no tipo, para que nenhum service novo fique sem nome. São 29
  mudanças mecânicas em `src/db/services/`.
- **Medição no laço de `defineService`,** no método público, em volta de
  `inTx`/chamada direta: `service.op`, duração em ms, `nested` (quando
  `opts.tx` veio preenchido, ou seja, chamada de dentro de outro service) e o
  tipo do ator. Uma linha JSON quando a duração passa do limiar.
- **Limiar configurável por ambiente** (`SLOW_SERVICE_MS`, padrão 100 ms), e
  desligável.
- **Ligação com a requisição sem passar parâmetros:** um middleware guarda
  `{ requestId, método, padrão da rota }` num `AsyncLocalStorage`, e o wrapper
  o lê. O `requestId` também vai num cabeçalho da resposta, para cruzar com o
  log do Caddy. Se o middleware por requisição de
  `metricas-de-performance-no-servidor.md` vier junto, os dois compartilham
  esse contexto.
- **Fora de `defineService`:** `src/db/services/grading-job-queue.ts` e
  `rubric-store.ts` ficam de fora do laço. A fila é suspeita do incidente,
  então os pontos de entrada dela usam o mesmo wrapper à mão.

Exemplo de linha:

```json
{"slow":"service","op":"gradingJob.claim","ms":812,"nested":false,"req":"a1b2","route":"POST /api/grading-jobs/claim","actor":"bot"}
```

## Leitura dos números

- O tempo é de relógio. Com o event loop congestionado, uma chamada parada
  num `await` conta o tempo de outras requisições, e um service pode parecer
  lento quando o servidor é que está saturado. Ler junto com o atraso do event
  loop.
- A chamada de fora inclui o tempo das de dentro (`nested`).
- O tempo inclui abrir o `$transaction`, o que no SQLite pode incluir esperar
  outra transação.

## Critérios de aceitação

- [ ] `defineService` exige um nome, e todos os services o declaram.
- [ ] Uma chamada acima do limiar gera uma linha JSON com `op`, `ms`,
  `nested`, `requestId` e rota. Abaixo do limiar, nada.
- [ ] Os pontos de entrada da fila de correção também são medidos.
- [ ] Teste unit: um service falso com um `op` lento loga, um rápido não, e o
  contexto da requisição aparece na linha.
- [ ] O custo do wrapper é medido num microbenchmark e fica desprezível
  (< 1 µs por chamada).
