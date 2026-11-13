---
type: issue
status: backlog
tags: [performance, database, sqlite, runtime, research]
relatedTo: [sqlite-em-modo-wal, metricas-de-performance-no-servidor]
kind: research
priority: low
created: 2026-11-13
creator: claude
---

# Estudar migrar para Turso e/ou Bun

## Contexto

O humano viu na internet a possibilidade de usar Turso e/ou Bun para escalar o
servidor. Nada aqui foi validado: é um estudo, não uma decisão. As
afirmações abaixo vêm da memória do agente e precisam ser conferidas nas
fontes oficiais antes de qualquer conclusão.

Restrições atuais do codehood: Astro 7 com `@astrojs/node` (standalone), um
processo Node, Prisma 7 com `@prisma/adapter-better-sqlite3` (síncrono, na
thread principal). Tudo, de SSR a JSON e queries, disputa um núcleo, e uma
query ou um commit lento trava o servidor inteiro.

## Perguntas a responder

**Turso**

- "Turso" pode ser duas coisas: o serviço/libSQL (fork do SQLite, com
  `@libsql/client` e um adapter Prisma oficial) ou a reescrita do SQLite em
  Rust (antigo Limbo), com I/O assíncrono e escrita concorrente (MVCC).
  Qual delas era a sugestão? Qual o grau de maturidade de cada uma hoje?
- Para arquivo local, o `@libsql/client` bloqueia o event loop como o
  `better-sqlite3` ou faz as queries fora da thread principal?
- Algum dos dois permite escritas concorrentes de verdade (mais de um
  escritor), ou só tira o bloqueio do event loop?
- O Prisma 7 suporta o Turso novo, ou só o libSQL? O que não funciona
  (migrations, `$transaction` interativa, tipos `Json`)?
- Implica sair da VPS para um serviço gerenciado, ou roda local/embutido?
  Custo, latência e backup em cada caso.

**Bun**

- O Astro 7 roda em Bun com `@astrojs/node`, ou precisa de outro adapter?
  O que quebra (Vite, middleware, Prisma, Playwright, `node:*` usados)?
- O `bun:sqlite` é síncrono como o `better-sqlite3`. O ganho viria do runtime
  mais rápido, não de concorrência. Tem adapter Prisma para ele?
- Bun facilita vários processos (por exemplo `reusePort`) melhor que o
  `cluster` do Node?

**Comparação**

- Comparar com as alternativas mais baratas: WAL
  (`dev/issues/sqlite-em-modo-wal.md`), vários processos Node com SQLite em
  WAL, e Postgres.
- Decidir só depois de ter as métricas
  (`dev/issues/metricas-de-performance-no-servidor.md`): se o gargalo for
  uma query ou o `fsync`, nenhuma migração é necessária.

## Critérios de aceitação

- [ ] Uma nota em `dev/` responde às perguntas acima com fontes (links da
  documentação oficial, versões testadas).
- [ ] Um protótipo mede, no mesmo hardware, o p95 de uma rota de escrita
  (autosave) e do `claim` em: atual, atual + WAL, e a alternativa mais
  promissora.
- [ ] Recomendação: migrar, não migrar, ou adiar, com o custo estimado.
