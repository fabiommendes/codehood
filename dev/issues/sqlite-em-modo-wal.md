---
type: issue
status: todo
tags: [performance, database, sqlite, ops]
relatedTo: [metricas-de-performance-no-servidor]
kind: enhancement
priority: high
created: 2026-11-13
creator: claude
---

# Ligar o modo WAL do SQLite

## Problema

O servidor roda num processo Node só, e o banco é SQLite com
`@prisma/adapter-better-sqlite3`, que é síncrono: cada query e cada commit
seguram o event loop até terminar. `src/db/client.ts` cria o adapter só com a
URL, sem nenhum `PRAGMA`. Então, a menos que alguém tenha ligado à mão na VPS,
o banco está no modo padrão: journal de rollback com `synchronous=FULL`.

Nesse modo, cada commit faz vários `fsync` (journal e banco). No disco de uma
VPS, cada um pode levar de milissegundos a dezenas de milissegundos, e o
servidor inteiro fica parado esperando. Numa prova, há muitas escritas
pequenas: autosave dos alunos, reserva, renovação de reserva e resultado de
cada worker. Na `teste2-elm` (2026-11-13), o servidor respondeu com 502 e
timeouts sob essa carga
(`dev/issues/metricas-de-performance-no-servidor.md`). Este pode ser um dos
fatores, mas sem métricas não foi possível confirmar.

## Proposta

- Na inicialização do client (`src/db/client.ts`), antes da primeira query:

  ```ts
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  ```

  O `journal_mode` usa `$queryRawUnsafe` porque devolve uma linha. O
  `busy_timeout` só passa a importar com mais de um processo, mas é inofensivo
  com um só.
- Em WAL com `synchronous=NORMAL`, o commit só acrescenta ao `-wal`, e o
  `fsync` acontece no checkpoint. Risco aceito: uma queda de energia ou do
  kernel pode perder os últimos commits, sem corromper o banco. Se só o
  processo morrer, nada se perde.
- Antes de ligar, conferir o estado atual na VPS:
  `sqlite3 <banco> 'PRAGMA journal_mode; PRAGMA synchronous;'`.
- Backup: em WAL, parte dos dados recentes fica em `<banco>-wal`. Um backup
  que copia só o `.db` com `cp`/`rsync` pode perder os últimos commits. O
  backup passa a usar `sqlite3 <banco> '.backup <destino>'` ou
  `VACUUM INTO`. Conferir o script de backup da VPS (não está no
  repositório).
- Medir antes e depois, com as métricas da issue relacionada ou com um
  teste de carga simples de autosave e `claim`.

## Critérios de aceitação

- [ ] Em produção, `PRAGMA journal_mode` responde `wal` e `PRAGMA synchronous`
  responde `1` depois de reiniciar o servidor.
- [ ] Os testes e o dev server continuam funcionando, e o `.gitignore` cobre
  `*.db-wal` e `*.db-shm` (hoje só tem `*.db` e `*.db-journal`).
- [ ] O backup da VPS usa `.backup` ou `VACUUM INTO`, e uma restauração foi
  testada.
- [ ] Existe uma medida, antes e depois, do tempo de commit ou do p95 de uma
  rota de escrita (autosave).
