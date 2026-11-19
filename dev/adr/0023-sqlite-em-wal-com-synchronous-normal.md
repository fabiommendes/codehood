---
type: adr
status: accepted
tags: [database, sqlite, performance, ops]
relatedTo: [sqlite-em-modo-wal, lentidao-na-prova-de-2026-11-18]
created: 2026-11-19
creator: claude
---

# SQLite em WAL com `synchronous=NORMAL`

O servidor é um processo Node com uma conexão SQLite síncrona
(`@prisma/adapter-better-sqlite3`): enquanto um commit não termina, nenhuma
outra requisição anda. No modo padrão do SQLite, journal de rollback com
`synchronous=FULL`, isso custou caro duas vezes:

- **Custo do commit.** Cada commit faz `fsync` do journal e do banco. Na VPS
  de produção são 5 a 6 ms de mediana, contra 0,1 ms em WAL. Na prova de
  2026-11-18, com 9 saves por minuto por aluno, esse tempo virou fila.
- **Leitor bloqueia escritor.** Em 2026-11-19 uma consulta feita à mão com
  `sqlite3 -readonly` varreu `Submission` por 19 s durante uma prova. O
  `COMMIT` do servidor esperou os 5 s do `timeout` do better-sqlite3 e falhou
  com `SQLITE_BUSY`. O adapter (7.9.1) não se recupera disso: não manda
  `ROLLBACK`, a conexão fica dentro da transação, o `BEGIN` seguinte falha e
  o mutex do adapter não é solto. Toda escrita falhou por 7 minutos, das
  17:06 às 17:13, até o serviço ser reiniciado. As leituras continuaram.

## Decisão

- **Toda conexão abre em `journal_mode=WAL` com `synchronous=NORMAL`.**
  `src/db/client.ts` roda os dois pragmas antes da primeira query. O
  `journal_mode` fica gravado no arquivo; o `synchronous` é por conexão.
- **`DATABASE_JOURNAL_MODE=delete` é a saída de emergência.** Volta ao journal
  de rollback com `synchronous=FULL` no próximo início do servidor, sem novo
  build. Qualquer outro valor impede o servidor de subir.
- **O defeito do adapter não é corrigido aqui.** Em WAL um leitor não bloqueia
  o escritor, e o gatilho some. A sequência foi reproduzida localmente em
  2026-11-19: com um `sqlite3` segurando uma transação de leitura, em
  `delete` a escrita falha em 5 s e as seguintes em 2 s cada
  ("Unable to start a transaction in the given time"); em WAL a mesma
  escrita passa em 9 ms com o leitor aberto.

## Alternativas descartadas

- **WAL com `synchronous=FULL`.** Mantém um `fsync` por commit, que é o custo
  que se quer tirar.
- **Ficar em `delete` e corrigir o adapter.** Resolve o travamento, não o
  custo do commit, e o leitor continuaria segurando o escritor por até 5 s.
- **Trocar de driver.** O SQLite tem um escritor só de qualquer forma, e o
  `@prisma/adapter-libsql` com arquivo local também é síncrono por baixo (não
  conferido na documentação atual).

## Consequências

- **Durabilidade.** Uma queda de energia pode perder os últimos commits, que
  ainda não passaram por um checkpoint; nunca corrompe o arquivo. A queda só
  do processo não perde nada. Para respostas de prova a perda é aceita: a
  página guarda rascunho local e reenvia.
- **Backup.** Dados recentes ficam em `<banco>-wal`. O backup usa
  `sqlite3 ".backup"` ou `VACUUM INTO`, nunca a cópia só do `.db`. Apagar um
  banco é apagar também o `-wal` e o `-shm`.
- **Consultas em produção.** Um leitor de fora deixa de travar o servidor.
  Um leitor que fica aberto por muito tempo ainda impede o checkpoint de
  encurtar o `-wal`.
- **Ainda há um escritor só.** Outro processo que escreva no banco por mais
  de 5 s (um comando do `manage`, por exemplo) pode fazer um `COMMIT` do
  servidor falhar e, em tese, disparar o mesmo travamento. Não foi testado.
  Não rodar escrita longa por fora com o servidor em uso.
- **Quem voltar a `delete` volta ao risco do leitor.** Nesse modo, não
  consultar o banco com alguém salvando, e conferir a que horas roda o
  backup.
- **Troca de modo.** O banco muda de modo no primeiro início depois do
  deploy. Não fazer esse deploy com uma prova em andamento.
