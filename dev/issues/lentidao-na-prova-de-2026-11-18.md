---
type: issue
status: todo
tags: [performance, exam, sqlite, ops]
relatedTo: [oom-ao-carregar-submissoes-do-curso, sqlite-em-modo-wal, custo-por-requisicao-na-prova, metricas-de-performance-no-servidor]
kind: defect
priority: high
created: 2026-11-18
creator: claude
---

# Lentidão na prova de 2026-11-18 com muitos alunos enviando

O log de produção foi lido, com horários em UTC. As medidas abaixo vêm do dia
inteiro; o arquivo guardado, `.perf/prova-2026-11-18/prova.jsonl`, cobre só
das 14:00 às 19:00 (hora local) e inclui os traces das quedas. Duas causas: o `fsync` por commit, confirmado
abaixo, e 17 quedas do servidor por falta de memória, corrigidas em
2026-11-19 (`dev/specs/to-review/listagens-sem-historico-de-autosave.md`).
As correções do `fsync` estão em "O que foi feito em 2026-11-19", no fim.

## Sintoma

Durante uma prova na v0.6.0, o servidor ficou lento quando muitos alunos
enviavam dados ao mesmo tempo. Na VPS, o único recurso saturado era a escrita
em disco: leitura baixa, CPU baixa, memória estável em 750 MB de 1 GB
(observação do instrutor, sem números do log ainda).

## Hipótese descartada: o grant de questões

A suspeita inicial era a refatoração da autorização de questões (commits de
2026-11-17, `src/db/services/exam-questions.ts`). Não se confirmou:

| Rota | Queries em 16/nov | Queries na v0.6.0 | SQLite p50 |
| :-- | --: | --: | --: |
| `POST /_actions/exam.answer` | 14 | 14 | 3,3 ms |
| `POST /_actions/answerHistory.send` | 17 | 17 | 3,2 ms |
| `GET .../exams/[slug]` | 55 | 61 | 9,9 ms |

- Medido com `pnpm run test:perf --scale 0.3` nas specs de prova
  (`.perf/2026-11-18T19-23-21/`), contra `.perf/2026-11-16T20-32-01/`.
- Nenhum statement lento na base cheia. A migração da v0.6.0 recria todos os
  índices de `ResponseRef` e `Submission`.
- O grant só pesa em leituras. Por leitura do código, o polling
  `gradingJob.forStudentQuestions` foi de 3 para cerca de 9 queries, e a
  página da prova emite um grant por questão de código
  (`src/utils/load-attempt-view.ts`). Nenhum dos dois foi medido.
- Não medidos: anexos de questão e a API do worker.

Limite dessas medidas: os testes põem o banco em `/dev/shm`, onde `fsync` não
custa nada. Elas não dizem nada sobre o custo do commit em produção.

## Causa confirmada: `fsync` por commit

A produção está em `journal_mode=delete` com `synchronous=FULL` (conferido
na VPS), e `src/db/client.ts` não define pragma algum. Cada commit faz vários `fsync`, e o `better-sqlite3` é síncrono:
enquanto o disco confirma, o processo inteiro espera. Isso bate com disco de
escrita saturado e CPU ociosa. A correção já está descrita em
`sqlite-em-modo-wal`.

Quem gera os commits:

- **Autosave da resposta** (`queueAnswer` e `saveNow` em
  `src/components/exam/ExamAttempt.tsx`): já é por questão. Texto salva 500 ms
  depois da última tecla (`SAVE_DELAY_MS`); resposta objetiva salva a cada
  clique. Cada save é uma transação que insere uma linha em `Submission` com o
  texto inteiro da resposta. O servidor não deduplica autosave.
- **Histórico de edição** (`src/services/answer-edits/coordinator.ts`): um
  lote por tentativa a cada 55–65 s. Agrupa teclas com até 1 s de intervalo
  numa entrada (`DEFAULT_PAUSE_MS` em `monitor.ts`). Custo desprezível; não
  vale desligar.

## O que o log mostrou

Provas das 14:00 às 18:00 (hora local), com 77 a 99 alunos por hora.

| Medida | Valor |
| :-- | --: |
| `POST /_actions/exam.answer` no dia | 119 091 |
| Pico de commits por minuto | 1 270 |
| `commitP99` no pico | 60 a 160 ms |
| `COMMIT` mais lento | 5,8 s |
| `loopBusy` no pico | 0,6 a 0,86 |
| Tempo médio de SQLite por `exam.answer` | 26 ms (3,3 ms em `/dev/shm`) |
| Saves por aluno, 16:30 às 17:00 | mediana 338, máximo 661 |
| `Submission` no dia | 42 569 para 161 811 |
| Tamanho do banco no dia | 77 MB para 228 MB |

- 1 492 das 2 132 linhas `slow-query` são o `COMMIT` de `response.answer`.
  Nenhum statement de leitura dessa rota aparece.
- A mediana de 338 saves em 30 minutos dá 11 por aluno por minuto, bem acima
  do que o autosave de 500 ms fazia supor.
- A 1 200 commits por minuto e 26 ms cada, o laço fica preso cerca de 31 s
  por minuto só em `exam.answer`, o que bate com o `loopBusy` medido.
- Memória e swap da VPS estavam folgados às 22:52 (402 MB disponíveis, 38 MB
  de swap). O disco não estava saturado por outro processo.
- Outros statements lentos, fora da prova: o `SELECT` de `gradingJob.claim`
  chegou a 18 s às 00:51, e o `UPDATE ApiKey SET lastUsedAt` do worker a
  3,3 s. Não investigados.

### Medidas diretas na VPS (2026-11-19, servidor ocioso)

O `fsync` simples do disco é rápido: `write` + `fsync` de 4 KiB em 0,29 ms de
mediana e 3,9 ms de p99, igual a um SSD local. O que custa é o commit do
SQLite em modo `delete`, que cria, sincroniza e apaga o journal a cada
transação. Inserindo autosaves numa cópia do banco de produção, na VPS:

| Modo | `COMMIT` p50 | p90 |
| :-- | --: | --: |
| `delete`, `synchronous=FULL` (hoje) | 4,5 a 5,9 ms | 11 a 18 ms |
| `wal`, `synchronous=FULL` | 1,0 a 2,3 ms | 3 a 6 ms |
| `wal`, `synchronous=NORMAL` | 0,1 ms | 0,2 ms |

A faixa é entre commits em sequência e um commit a cada 100 ms. O servidor em
prova gastou mais que isso por save (15 a 23 ms de SQLite de mediana), então
parte do custo vem da carga concorrente e não só do commit isolado. O WAL com
`synchronous=NORMAL` tira o commit da conta.

### Ritmo real dos saves

Das 14:00 às 19:00, 174 alunos e 103 mil saves. Por aluno, a mediana é de
9,3 saves por minuto e de 1,6 s entre dois saves; 61% dos intervalos têm
menos de 2 s. O aluno salva a cada palavra, porque qualquer parada de 500 ms
dispara o autosave. `test/load/calibrate.ts` refaz essa conta, e os perfis do
teste de carga foram ajustados a ela.

Para repetir a leitura:

```sh
ssh root@codehood.dev 'journalctl -u codehood -o cat --since "2026-11-18 00:00" | gzip -c' > dia.jsonl.gz
jq -c 'select(.event=="process") | {at, loopBusy, commits, commitP99, commitMax, txWaitMax, requests}' prova.jsonl
```

Sem `gzip` a conexão caiu aos 32 MB.

## Ideias discutidas, nada decidido

- WAL com `synchronous=NORMAL`, já em `sqlite-em-modo-wal`. Antes, conferir o
  backup em `deploy/`: o `-wal` passa a fazer parte do banco. Não trocar o
  modo com uma prova em andamento.
- Autosave da resposta no máximo uma vez por minuto por questão, contando da
  primeira edição não salva e não da última tecla, para que quem digita sem
  parar ainda seja salvo. Sair do campo, o prazo e a entrega já salvam na
  hora, e o rascunho local cobre o intervalo. Os testes e2e esperam o save em
  500 ms: o prazo teria de ser configurável.
- Histórico de edição a cada 5 min com jitter, até 10 min. A condição de 30 s
  sem novas entradas parece dispensável, porque os lotes são imutáveis. O
  ganho é pequeno.
- Trocar de driver não resolve: `@prisma/adapter-libsql` com arquivo local
  também é síncrono por baixo (não conferido na documentação atual), e o
  SQLite tem um escritor só de qualquer forma.

## O que foi feito em 2026-11-19

Nada disto está em produção ainda.

- Listagens sem o histórico de autosave (`24d22b7a`), que era o que esgotava
  a memória. O release gera a migração do índice novo de `Submission`.
- Autosave de texto no máximo uma vez a cada 30 s por questão (`9c18ff34`).
- WAL com `synchronous=NORMAL` (`56f725dc`). Não fazer esse deploy com uma
  prova em andamento; depois, conferir `PRAGMA journal_mode` na VPS.
- Telas de instrutor da prova: a fila de correção lê só os envios e a
  correção das objetivas roda em lote. Cada tela caiu de 620 a 1150 queries
  para 86 a 144, e a mais lenta de 2,7 s para 0,44 s.
- O aluno sintético passou a seguir o prazo como a página (`test/load/`). A
  fila de saves no fim da prova era do teste: a página não chama
  `exam.finish` no prazo. Com isso, `exam.answer` nos últimos 30 s tem p95
  de 286 ms com 60 alunos (`.load/reports/2026-11-19T18-50-28/`).

Medido e descartado:

- Não inserir autosave idêntico ao anterior. Numa cópia do banco de produção
  de 2026-11-19, 3 737 de 170 446 autosaves (2,2%) repetem a submissão
  anterior da mesma tentativa e questão: 2,5 MB de 150 MB.
- Espalhar o save final pelo último minuto: a rajada sincronizada não existe
  na página real.

Adiado:

- Rascunho único por questão com retrato a cada N minutos.
- Limpeza dos autosaves antigos em produção: irreversível, exige aval e
  backup, e só importa pelo tamanho do arquivo.

Falta:

- Repetir a rodada de carga numa máquina sem outras suítes, com 100 alunos e
  10 min, antes do deploy.
- O deploy, fora de horário de prova.
- `commit-que-falha-trava-a-escrita`, achado ao medir os autosaves.
