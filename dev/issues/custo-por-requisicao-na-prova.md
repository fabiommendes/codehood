---
type: issue
status: todo
tags: [performance, exam, grading-bot]
relatedTo: [teste-de-carga-da-prova, metricas-de-performance-no-servidor, sqlite-em-modo-wal]
kind: enhancement
priority: medium
created: 2026-11-14
creator: claude
---

# Custo por requisição durante a prova

## Problema

A causa do travamento da `teste2-elm` foi corrigida (índices em `Submission`
e a busca do `claim`, ver o changelog). O teste de carga com
`--history 50000` mostrou o que sobrava, em ordem de peso. Os três primeiros
itens foram corrigidos; restam estes, que não derrubam o servidor com 100
alunos mas decidem quantos alunos cabem num núcleo.

1. **`promoteExpiredSends` em todo `claim`.** Custa ~20 ms de CPU por `claim`
   com 100 tentativas abertas, e durante a prova nenhuma delas está vencida.
   Filtrar primeiro as tentativas vencidas pelo horário e só então olhar as
   submissões.
2. **Um autosave é uma linha nova.** Uma prova de 4 min com 100 alunos criou
   ~2 mil linhas em `Submission`; uma prova real cria dezenas de milhares.
   Com os índices isso deixou de pesar nas leituras, mas o banco cresce sem
   limite. Avaliar apagar os autosaves antigos ao fechar a tentativa.
3. **Statements não reaproveitados.** O adapter compila cada SQL de novo
   (`prepare` é ~40% do tempo de SQLite nos relatórios).
4. **O `COMMIT` de cada save** (2,5 ms de `fsync` por chamada, mais na
   VPS). Sai com WAL e `synchronous=NORMAL`; ver `sqlite-em-modo-wal`.
5. **O que sobra em `exam.answer`.** 22 queries num envio de código: a
   questão é resolvida em 3 (`resolveExamQuestion`), o `touch` lê a versão
   antes de gravar, e o envio relê a tentativa em `forStudent`. O client do
   Prisma gasta mais CPU interpretando cada query do que o SQLite em
   rodá-la, então o ganho vem de fazer menos queries.
6. **O `probe-db.mjs` custa caro.** A captura de stack por query soma cerca
   de um quarto da CPU do servidor no teste de carga, e infla os números de
   CPU por rota.
7. **Workers falhando o build de forma intermitente** no teste de carga:
   `ENOENT … mkdir 'elm-stuff/generated-code/…'` na checagem da solução de
   referência, em parte dos workers de duas rodadas. Os envios acabam
   corrigidos nas tentativas seguintes, mas o tempo de correção dessas
   rodadas não é comparável.

## Feito

Medido com `pnpm run load --scenario queue --grading-workers 4 --history
50000 --duration 4m --ramp 1m --memory 1500M --cpu 100%` (relatórios
`request-cost-before` e `request-cost-after`, uma rodada de cada):

| | antes | depois |
| :-- | --: | --: |
| requisições | 9643 | 3053 |
| p95 / p99 | 16,7 s / 19,3 s | 1,9 s / 8,6 s |
| CPU do servidor | 78% | 62% |
| polling: requisições | 7843 | 1253 |
| polling: CPU | 57,4 s | 12,1 s |
| SQLite, total | 33,1 s | 23,4 s |
| correção p50 / p95 | 69 s / 85 s | 55 s / 73 s |

- Polling por questão: a página chama `gradingJob.forStudentQuestions` uma
  vez por aluno, e o documento da questão só é lido quando há relatório.
- Matrículas: `enrollmentsOf(actor)` em `response`, `question`, `submission`
  (listagem), `answer-edit`, `exam.findOne` e `gradingJob.forStudent*`. Os
  outros services ainda carregam a turma (`courseAccess`,
  `submission.service` por linha, `feedback`, `resource`, `roll-call`…);
  alguns usam a lista para outra coisa, então cada um pede uma leitura.
- `validateApiKey` grava `lastUsedAt` no máximo uma vez por minuto: o
  `UPDATE` (965 execuções, 2,3 s) saiu do relatório.

Depois, em `exam.answer` (relatório `request-cost-after3`): `response.answer`
no lugar de `response.submit` + `exam.findOne`, e a sessão validada numa
query.

| por envio de código | antes | depois |
| :-- | --: | --: |
| queries | 46 | 22 |
| SQLite | 6,3 ms | 4,6 ms |
| CPU (com o probe) | 19,6 ms | 14,7 ms |

## Critérios de aceitação

- [x] Itens de polling, matrículas e `lastUsedAt` corrigidos, com o antes e
  depois do teste de carga.
- [ ] Itens 1 a 7 decididos (corrigir ou registrar por que não).
