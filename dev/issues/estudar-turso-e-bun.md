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

O alvo é a reescrita do SQLite em Rust (antigo Limbo), com I/O assíncrono e
escrita concorrente (MVCC), não o serviço libSQL (fork do SQLite com
`@libsql/client`).

- Qual o grau de maturidade dela hoje (beta, produção)? Quais recursos do
  SQLite ainda faltam?
- O binding de Node faz as queries fora da thread principal, ou ainda
  bloqueia o event loop?
- A escrita concorrente (MVCC) já funciona com vários processos ou conexões
  no mesmo arquivo? Com quais garantias?
- O Prisma 7 tem adapter para ela? O que não funciona (migrations,
  `$transaction` interativa, tipos `Json`)? Se não houver adapter oficial,
  quanto custa escrever um?
- Roda local/embutido na VPS, ou empurra para um serviço gerenciado? Como
  fica o backup?

**Bun**

O humano buscou só sobre o Prisma, e a busca indicava que funciona no Bun, mas
sem evidência concreta. Tudo abaixo está por conferir.

- O Prisma 7 roda no Bun de verdade? Com qual adapter de SQLite? Há exemplo
  oficial ou issue confirmando?
- O Astro 7 roda em Bun com `@astrojs/node`, ou precisa de outro adapter?
  O que quebra (Vite, middleware, Playwright, `node:*` usados)?
- O `bun:sqlite` é síncrono como o `better-sqlite3`. O ganho viria do runtime
  mais rápido, não de concorrência.
- Bun facilita vários processos (por exemplo `reusePort`) melhor que o
  `cluster` do Node?

**Comparação**

- Comparar com as alternativas mais baratas: WAL
  (`dev/issues/sqlite-em-modo-wal.md`), vários processos Node com SQLite em
  WAL, e Postgres.
- Decidir só depois de ter as métricas
  (`dev/issues/metricas-de-performance-no-servidor.md`): se o gargalo for
  uma query ou o `fsync`, nenhuma migração é necessária.

## Achados da primeira pesquisa (2026-11-13)

Pesquisa só em documentação e páginas, sem nenhum teste local. A maioria das
fontes secundárias (blogs, agregadores) foi descartada ou marcada como tal.

**Turso (reescrita em Rust)**

- Maturidade: o FAQ do README diz que já roda em produção em várias
  organizações, mas que "we have not yet reached 1.0". O pacote de Node
  avisa: "not yet reached 1.0 [...] we recommend keeping backups"
  ([README](https://github.com/tursodatabase/turso),
  [npm](https://www.npmjs.com/package/@tursodatabase/database)).
- `BEGIN CONCURRENT` (MVCC): o README o lista entre os recursos, mas o
  [COMPAT.md](https://github.com/tursodatabase/turso/blob/main/COMPAT.md) fala
  em "experimental MVCC mode", com uma lacuna de durabilidade: "a write that
  reported success is not durable while sibling statements remain active".
  Fontes secundárias citam também a falta de suporte a índices no MVCC,
  inicialização lenta em bancos grandes e a falta de `SAVEPOINT`
  ([Better Stack](https://betterstack.com/community/guides/databases/turso-explained/),
  [benchmark de terceiros](https://github.com/momina0/turso-concurrent-writes)).
  Esse benchmark mediu 5,3× a vazão do SQLite com 8 escritores, mas o SQLite
  ainda foi mais rápido com um escritor só e transações curtas.
- Vários processos no mesmo arquivo: está em "experimental features" no
  README ("Multi-process WAL coordination via the `.tshm` sidecar"). O
  COMPAT.md diz que não há suporte para misturar SQLite e Turso em
  multiprocesso.
- Lacunas de compatibilidade (COMPAT.md): funções de janela (`lag`, `lead`,
  `ntile`...), `INSTEAD OF` triggers, FTS (há um FTS próprio), collations
  customizadas, vários PRAGMAs; a API de backup é stub.
- Binding de Node (`@tursodatabase/database`): `await connect("app.db")` abre
  arquivo local, mas a documentação não diz se as queries rodam fora da
  thread principal. O exemplo do README chama `stmt.all()` sem `await`, o que
  sugere chamada síncrona. O I/O assíncrono (`io_uring`) é do motor, não
  necessariamente do binding. **Em aberto: medir o atraso do event loop.**
- Prisma: **não há adapter para a reescrita em Rust.** A
  [página de Prisma da Turso](https://docs.turso.tech/sdk/ts/orm/prisma) e o
  `@prisma/adapter-libsql` cobrem só o libSQL (o fork em C), focados no Turso
  Cloud. A página ainda usa o estilo pré-Prisma 7 (`driverAdapters` em
  preview) e diz que o Prisma Migrate não funciona contra o Turso. Usar a
  reescrita com Prisma exigiria escrever e manter um driver adapter próprio.

**libSQL (`@libsql/client`, para comparação)**

- Tem adapter oficial (`@prisma/adapter-libsql`, versão 7.x). Um projeto de
  terceiros afirma que o `@libsql/client` é o único driver de SQLite mantido
  com I/O totalmente assíncrono
  ([knex-libsql-client](https://github.com/paleo/knex-libsql-client)), mas é
  uma afirmação não verificada. **Em aberto: se o modo `file:` tira as
  queries da thread principal.**

**Bun**

- Prisma 7 no Bun: a
  [documentação oficial](https://www.prisma.io/docs/v7/prisma-orm/quickstart/sqlite)
  diz para usar `@prisma/adapter-libsql` no lugar de
  `@prisma/adapter-better-sqlite3`, porque "Bun doesn't support the native
  SQLite driver that `better-sqlite3` relies on". O Prisma Studio com SQLite
  ainda não funciona no Bun. O [guia do Bun](https://bun.sh/guides/ecosystem/prisma)
  também usa o libSQL. **Migrar para Bun obriga a trocar o adapter atual.**
- Adapter `bun:sqlite`: só comunitário. O
  [prisma-adapter-bun-sqlite](https://github.com/mmvsk/prisma-adapter-bun-sqlite/)
  (Prisma ≥ 7, Bun ≥ 1.3, 154 testes segundo o autor, 32 estrelas, última
  versão 0.8.0 em 2026-04-23) é síncrono como o `better-sqlite3`. Outro, o
  `@abcx3/prisma-bun-adapter`, foi relatado como não pronto para produção
  ([discussão no Bun](https://github.com/oven-sh/bun/discussions/21897)).
- Astro no Bun: a [receita oficial](https://v4.docs.astro.build/en/recipes/bun/)
  diz que qualquer adapter funciona pela compatibilidade com Node
  (`bunx --bun astro build`). Não há modo Bun no `@astrojs/node`; os adapters
  nativos são comunitários (por exemplo
  [astro-bun-adapter](https://github.com/Igloczek/astro-bun-adapter)). A receita
  encontrada é da documentação v4/v5; **conferir para o Astro 7.**
- Vários processos: o `Bun.serve` tem `reusePort` (só Linux, via
  `SO_REUSEPORT`), e o [guia de cluster](https://bun.sh/guides/http/cluster)
  sobe um processo por núcleo com `spawn`. É mais simples que o `cluster` do
  Node, mas o Node também pode usar `SO_REUSEPORT` ou vários upstreams no
  Caddy.

**Conclusão provisória**

- A reescrita do Turso é o único caminho que promete escrita concorrente, mas
  hoje não tem adapter Prisma, o MVCC tem lacunas de durabilidade
  documentadas e o modo multiprocesso é experimental. Não serve para o
  codehood agora. Vale acompanhar até a 1.0.
- O Bun não resolve a concorrência: o SQLite continua síncrono (`bun:sqlite`)
  ou vira libSQL, que também roda no Node. O ganho seria só de velocidade do
  runtime, ao custo de trocar o adapter e validar Astro, Vite, Playwright e
  Prisma Studio.
- O que o Bun e o Turso oferecem e é viável hoje (vários processos e um
  driver possivelmente assíncrono via libSQL) também está disponível no Node.
  A ordem sugerida continua: métricas → WAL → medir o libSQL no Node →
  vários processos.

## Critérios de aceitação

- [ ] Uma nota em `dev/` responde às perguntas acima com fontes (links da
  documentação oficial, versões testadas).
- [ ] Um protótipo mede, no mesmo hardware, o p95 de uma rota de escrita
  (autosave) e do `claim` em: atual, atual + WAL, e a alternativa mais
  promissora.
- [ ] Recomendação: migrar, não migrar, ou adiar, com o custo estimado.
