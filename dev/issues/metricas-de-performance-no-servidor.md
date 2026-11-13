---
type: issue
status: todo
tags: [observability, performance, ops, grading-bot]
relatedTo: [log-de-erros-no-servidor-e-no-cliente, fila-de-correcao-externa]
kind: feature
priority: high
created: 2026-11-13
creator: claude
---

# Métricas mínimas de performance nos logs do servidor

## Problema

Na `teste2-elm` (`paradigmas`, 2026-11-13, ~15:30), com alunos fazendo a
prova e nove `chalk-worker` reservando envios, o `codehood.dev` passou a
responder 502 (Bad Gateway) e timeouts às chamadas dos workers. A página
inicial levava de 0,9 s a 7,7 s, enquanto a rede do professor estava normal
(27 ms até `1.1.1.1`). Depois de parar os workers, ela caiu para ~0,6 s.

Não houve como saber a causa: se foi a reserva da fila (`claim` devolve a
questão resolvida com todas as fontes de teste), a renovação das reservas,
o autosave dos alunos, o banco ou a memória da VPS. O servidor não registra
duração de requisição, o Caddy não guarda log de acesso, e a única fonte é o
`journalctl` com stack traces do Astro
(`dev/issues/log-de-erros-no-servidor-e-no-cliente.md`).

## Proposta

Mínimo necessário:

- Um middleware (`src/middleware.ts`, no início da `sequence`) que registra
  uma linha por requisição, em JSON (uma por linha, para `journalctl` e
  `jq`): horário, método, padrão da rota (não a URL crua, para agrupar e não
  vazar slugs nem tokens), status, duração em ms, tipo de credencial
  (sessão, `CLI`, `BOT`, anônimo) e id do usuário. Nunca corpo, cookie nem
  `Authorization`.
- Tempo gasto no banco por requisição: soma e número de queries, por uma
  extensão do Prisma (`$extends` com `query`). Uma linha extra quando uma
  query passa de um limiar (ex.: 500 ms), com modelo e operação.
- Uma linha periódica (ex.: a cada 60 s) com o estado do processo: memória
  (`process.memoryUsage()`), atraso do event loop
  (`perf_hooks.monitorEventLoopDelay`), requisições em andamento, tamanho do
  pool do banco, e a fila de correção (`GradingJob` por status, reservas
  ativas).
- Log de acesso do Caddy ligado, com tempo upstream, para separar um 502 do
  proxy de uma resposta lenta do app.
- Retenção: o que o `journald` já guarda, com um limite de tamanho
  configurado no deploy.

Desejável, não necessário:

- Uma página de admin (`src/pages/admin/`) para ler as últimas linhas de log
  e um resumo por rota (contagem, p50/p95, erros) da última hora, sem SSH na
  VPS. Pode ler de uma tabela com retenção curta ou de um buffer em memória.
  Combina com a página de exceções de `log-de-erros-no-servidor-e-no-cliente`.

## Critérios de aceitação

- [ ] Cada requisição gera uma linha JSON com rota, status, duração e tempo
  de banco, sem dados sensíveis.
- [ ] Com `journalctl -u codehood -o cat | jq`, dá para responder "quais
  rotas foram mais lentas entre 15:20 e 15:40" sem outra ferramenta.
- [ ] Queries acima do limiar aparecem com modelo e operação.
- [ ] A linha periódica mostra memória, atraso do event loop e a fila de
  correção.
- [ ] O Caddy registra os 502 com o tempo upstream.
- [ ] O custo da instrumentação é medido e fica abaixo de 1 ms por
  requisição.
