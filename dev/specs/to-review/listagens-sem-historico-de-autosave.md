---
type: spec
status: to-review
tags: [performance, exam, memory, service]
relatedTo: [lentidao-na-prova-de-2026-11-18]
---

# Listagens de tentativas sem o histórico de autosave

Item 1 de `autosave-e-quedas-na-prova.handoff.md`. Corrige o issue
`oom-ao-carregar-submissoes-do-curso`, fechado com este trabalho.

## Problema

`response.findMany` devolve cada tentativa com todas as suas `Submission`,
`payload` incluído. 98% delas são autosaves que ninguém lê: toda listagem só
usa a resposta que conta de cada questão. Com 165 mil submissões no curso, a
home do instrutor esgota o heap e o servidor cai.

## Contrato novo

`response.findMany` devolve, em `submissions`, só as submissões que contam.
Por questão da tentativa:

1. todos os envios (`SUBMIT` e `FINAL`);
2. a submissão mais nova;
3. a mais nova do próprio aluno (`createdBy` nulo), quando a mais nova é a que
   o instrutor criou para dar nota;
4. as que têm pedido de revisão.

"Mais nova" segue `isNewerSubmission`: maior `createdAt`, o `id` desempata. A
lista continua em ordem crescente, agora com o `id` como desempate.

Todo o resto do service (`findOne`, `create`, `update`, `upsert`, `finish`,
`submit`, `restartPreview`) continua devolvendo a tentativa com o histórico
inteiro. Quem precisa do histórico de uma tentativa usa `findOne`.

O filtro `history: true` de `responseFilter` devolve o histórico inteiro na
listagem, como antes. O padrão é `false`. Nenhum chamador do servidor o usa;
na API REST ele é o parâmetro `?history=true`.

## Quem lê `submissions` de uma listagem

Conferido chamador por chamador. Nenhum depende do histórico:

| Chamador | O que lê | Coberto por |
| :-- | :-- | :-- |
| `examResult` (homes, `course-grades`, `load-exam-staff`, `exams/index.astro`, `load-attempt-view`, `objective-review`, `question-stats`) | envios, ou a mais nova da questão | 1, 2 |
| `countingAnswers`, `attemptRows` (`grading.ts`) | o mesmo, e o conjunto de questões respondidas | 1, 2 |
| `measuredAttempts` (`question-stats.ts`) | descarta as do instrutor e usa a mais nova do que sobra | 3 |
| `load-attempt-view.ts` (`answers`, `answeredAt`) | a última de cada questão | 2 |
| `attempts/[username].astro` | a mais nova de cada questão | 2 |
| `grading/[question].astro` | acha a tentativa pela submissão que conta | 1, 2 |
| `regrades.astro` | a submissão de cada pedido de revisão | 4 |
| `actions/exam.ts` (`reopenAttempt`), `preview.astro` | só a tentativa | — |

Não passam por `response.findMany` e ficam como estão: `promoteFinalSends` e
`promoteExpiredSends` (consultam `Submission` direto, por `id`),
`attemptResults` em `exam.service.ts`,
`regrade-request.service.ts` e os envios de código (`gradingJob.forInstructor`,
`CodeSends*`).

`attemptResults` e `regrade-request.service.ts` carregam todas as submissões
de uma prova ou de uma tentativa, sem `payload`. Não derrubam o servidor e
ficam fora deste trabalho.

## API REST

`GET /api/course/[discipline]/[course]/response` passa a devolver as mesmas
submissões resumidas, e tudo com `?history=true`. `GET …/response/[publicId]`
continua com tudo. O formato da resposta não muda; o parâmetro novo entra no
OpenAPI, então o snapshot e o cliente do CLI são regenerados com
`pnpm run openapi:cli`. O CLI não lê `submissions` de uma listagem.

## Implementação

`findMany` deixa de usar o `include` de submissões:

1. Busca as tentativas sem submissões.
2. Uma consulta SQL devolve os `id` das submissões que contam dessas
   tentativas.
3. Busca essas submissões por `id` e as distribui pelas tentativas.

`Submission` ganha o índice `@@index([responseId, questionId, kind,
createdAt])`, que responde a seleção sem ler as linhas com `payload`. O índice
`@@index([responseId, questionId])` fica: é ele que dá a submissão mais nova
por `id` (`promoteFinalSends`, `findSentTwin`). Sem ele, o SQLite passa a
responder essas consultas pelo índice de `questionId` e lê as submissões da
questão em todas as tentativas, 24 ms por consulta na rodada de carga.

Medido numa tabela sintética de 165 mil linhas (200 tentativas, 10 questões,
900 bytes de payload em média):

| Consulta | Tempo no SQLite |
| :-- | --: |
| Carregar tudo (hoje, sem contar o Prisma) | 650 ms |
| Seleção só com o índice atual | 230 a 400 ms |
| Seleção com o índice novo | 29 ms |

O índice novo não perde dados; a migração sai no `pnpm run release`.

### `gradeObjectives`

As telas de instrutor de uma prova chamam `response.settleExpired`, que roda
`gradeObjectives` em cada tentativa encerrada enquanto houver resposta sem
correção, o que é sempre o caso de dissertativas e de código. Ele carregava
todas as submissões da tentativa com `payload` para achar a mais nova do aluno
em cada questão: 20 ms por tentativa e 3 a 4 s por tela na rodada de carga.
Passa a escolher os `id` em SQL e a ler só essas linhas. O comportamento não
muda.

## Testes

Unitários, em `test/response-service.spec.ts`, escritos antes do código:

- uma questão com vários autosaves aparece na listagem só com o mais novo;
- todos os envios de uma questão de código aparecem, e o autosave mais novo
  também;
- `createdAt` igual: vale o maior `id`;
- com uma submissão criada pelo instrutor mais nova que a do aluno, as duas
  aparecem;
- uma submissão antiga com pedido de revisão aparece;
- `findOne` da mesma tentativa devolve tudo;
- a listagem com `history: true` devolve tudo, na mesma ordem de `findOne`;
- um aluno continua vendo só as próprias tentativas;
- para cada tentativa do seed, `examResult` e `countingAnswers` dão o mesmo
  resultado com as submissões da listagem e com as de `findOne`.

Os specs que contam submissões a partir de uma listagem são ajustados para
`findOne`. Depois, os `e2e` das páginas da tabela acima e o `pnpm test`.

## Critério de aceite

A rodada abaixo termina sem quedas e com o save dos alunos no nível da rodada
sem `--instructor`:

```sh
pnpm run load --scenario monitor --students 60 --duration 5m --ramp 1m \
  --history 160000 --memory 600M --instructor 1m
```

O instrutor sintético (`test/load/instructor.ts`) passou a abrir também as
telas da prova em andamento e da prova antiga, que guarda os autosaves:
a prova, `grading`, `grading/[question]`, `exceptions` e `results`. A rodada
"antes" só abria a home e a página do curso.

| | Antes | Depois |
| :-- | --: | --: |
| Quedas | 4 | 0 |
| Saves com falha | 1 395 de 4 836 | 0 de 4 573 |
| `exam.answer` p95 | 3,6 s | 54 ms |
| `exam.answer` p95 sem instrutor | 40 ms | — |
| Home do instrutor | não respondia | 93 ms |
| Página do curso | não respondia | 110 ms |
| Telas da prova antiga | não medido | 0,4 a 0,8 s |

Relatório em `.load/reports/2026-11-19T13-44-38/`. O número de queries das
telas da prova (mais de 850 por tela em produção) é outro problema e fica
fora.

## Seed

Nenhum estado novo na interface, então `src/db/bootstrap.ts` não muda.

## Fora do escopo

- `feedback.findMany` carrega a submissão de cada correção com `payload`. São
  poucas linhas perto dos autosaves. Se a rodada de aceite ainda mostrar
  pressão de memória, vira um issue.
- Itens 2 a 4 do handoff (frequência do autosave, WAL, autosave idêntico).
