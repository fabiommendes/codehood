---
type: issue
status: todo
tags: [database, sqlite, ops, exam]
relatedTo: [sqlite-em-modo-wal, lentidao-na-prova-de-2026-11-18]
kind: defect
priority: high
created: 2026-11-19
creator: claude
---

# Um `COMMIT` que falha por banco ocupado trava toda a escrita

## Sintoma

Em 2026-11-19, das 17:06:20 às 17:13:46 (America/Sao_Paulo), todo
`exam.answer` em produção respondeu 400 depois de 2 s. Havia 4 alunos numa
prova e pelo menos 156 saves foram recusados. As leituras continuaram
funcionando. Só voltou com `systemctl restart codehood`.

## O que disparou

Uma consulta feita à mão na VPS, com `sqlite3 -readonly`, varreu `Submission`
por 19 s. O banco estava em `journal_mode=delete`, em que um leitor segura o
lock compartilhado e nenhum commit entra enquanto ele não termina.

O log do servidor, no primeiro save que falhou:

```
{"event":"slow-query","at":"2026-11-19T20:06:20.958Z","ms":5034.2,"sql":"COMMIT","op":"response.answer"}
```

Dali em diante cada `response.answer` levou 2000 ms, com uma query só, e
falhou. O arquivo `codehood.db-journal` ficou no disco até o restart.

## Hipótese, não conferida no código

Depois do `COMMIT` que falha com `SQLITE_BUSY`, a conexão continua dentro da
transação, com o lock de escrita reservado, e ninguém faz `ROLLBACK`. As
transações seguintes esperam por ela até o próprio limite de 2 s. O servidor
tinha dois descritores abertos para o banco.

## O que fazer

- Reproduzir: abrir um leitor longo num banco em `journal_mode=delete`,
  mandar uma escrita pelo servidor e ver se ele se recupera quando o leitor
  termina.
- Garantir o `ROLLBACK` quando o `COMMIT` falha, em `src/db/client.ts` ou no
  adapter, para o servidor voltar sozinho.
- Em WAL um leitor não bloqueia o escritor, então a causa some com
  `sqlite-em-modo-wal` em produção. O servidor ainda deve se recuperar, porque
  `DATABASE_JOURNAL_MODE=delete` continua existindo como saída de emergência
  e um checkpoint também pode devolver `SQLITE_BUSY`.

## Enquanto isso

- Não consultar o banco de produção com alguém salvando: copiar o arquivo e
  ler a cópia.
- O backup (`/usr/local/bin/codehood-backup`, com `.backup`) também é um
  leitor longo. Conferir a que horas ele roda.
- Há um backup de antes do restart em
  `/var/backups/codehood-pre-restart-20261119-1715/` na VPS.
