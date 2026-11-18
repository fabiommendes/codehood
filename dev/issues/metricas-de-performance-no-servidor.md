---
type: issue
status: todo
tags: [observability, performance, ops, grading-bot]
relatedTo: [log-de-erros-no-servidor-e-no-cliente, fila-de-correcao-externa]
kind: feature
priority: medium
created: 2026-11-13
creator: claude
---

# Métricas de performance: o que falta depois do log do servidor

## Contexto

Na `teste2-elm` (`paradigmas`, 2026-11-13) o `codehood.dev` respondeu 502 e
timeouts, e não havia como saber a causa. O servidor agora escreve o log de
performance de `src/perf/` (ver "Performance log" no `README.md` e o
changelog): linha por requisição, queries e services lentos, travamento do
event loop e uma linha periódica do processo. Esta issue guarda o que ficou
de fora.

## Falta fazer

- **Log de acesso do Caddy** com tempo upstream e o `X-Request-Id`, para
  separar um 502 do proxy de uma resposta lenta do app. O servidor já devolve
  e aceita o cabeçalho; a configuração do Caddy fica no repositório `deploy/`
  (exemplo no `README.md`).
- **Retenção do `journald`** com limite de tamanho, também no `deploy/`. Uma
  linha por requisição tem ~300 bytes.
- **Reproduzir o incidente com o log ligado.** Reverter o commit `9ff6d2e`
  numa branch descartável e rodar
  `pnpm run load --scenario queue --history 50000`: o log deve apontar o
  `claim` em `slow-query`, `slow-service` e `stall`. Até aqui o custo foi
  medido num build de produção com requisições em série, e os eventos foram
  conferidos em pequena escala.
- **CPU por requisição.** `ms` é tempo de relógio e inclui a espera pelo
  loop. Medir a CPU de cada requisição exige `async_hooks`, que tem custo em
  toda promise; por ora lê-se `ms` junto de `db` e do atraso do loop.
- **Página de admin** (`src/pages/admin/`) com as últimas linhas e um resumo
  por rota (contagem, p50/p95, erros) da última hora, sem SSH na VPS. Combina
  com a página de exceções de `log-de-erros-no-servidor-e-no-cliente`.

## Cuidados que o teste de carga mostrou

- Capturar a stack para saber quem chamou a query (`callerOf` em
  `test/load/probe-db.mjs`) custou cerca de um quarto da CPU do servidor. O
  log liga a query ao service pelo contexto da requisição
  (`AsyncLocalStorage`) e nunca captura stack.
- O adapter do SQLite tem dois caminhos síncronos: `performIO` (leituras) e
  `executeIO` (escritas e `COMMIT`). `src/perf/sqlite.ts` envolve os dois, e
  `test/perf.spec.ts` falha se uma versão nova do adapter mudar isso.
