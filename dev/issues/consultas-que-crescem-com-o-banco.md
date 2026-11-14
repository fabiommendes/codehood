---
type: issue
status: doing
tags: [performance, database, indexes]
relatedTo: [metricas-de-performance-no-servidor, custo-por-requisicao-na-prova, teste-de-carga-da-prova]
kind: bug
priority: high
created: 2026-11-14
creator: claude
---

# Consultas cujo custo cresce com o tamanho do banco inteiro

## Problema

`pnpm run test:perf` roda o e2e no banco do seed e no mesmo banco com 827 mil
linhas em cursos à parte (`test/fill/`, escala 1) e compara o tempo de SQLite
por rota. Uma rota de um curso que fica mais lenta depende do tamanho da
tabela inteira. Em 2026-11-14, 19 de 239 rotas dobraram ou mais. O tempo é
síncrono: enquanto a query roda, o servidor não atende mais ninguém.

## Achados, por custo

1. **`feedback.findMany` por curso ou por prova: 100–207 ms por chamada.** O
   filtro chega ao curso por `Feedback → Submission → ResponseRef → Exam`, o
   Prisma gera `LEFT JOIN` a partir de `Feedback` com
   `ORDER BY Feedback.submissionId`, e o SQLite percorre os 160 mil feedbacks
   do banco. Chamado por `POST /_actions/grading.state` (a cada correção), pela
   página da tentativa do aluno, por `GET /api/.../grades`, e pelos
   carregadores `load-grading.ts`, `course-grades.ts`,
   `load-instructor-home.ts` e `load-student-home.ts`. Partir das provas do
   curso (subconsulta em `submissionId`, ou SQL crua como `unsentAutosaveSql`)
   resolve.
2. **`Feedback.rubricId` sem índice: até 25 ms.** `rubric.update`,
   `updateItem`, `deleteItem`, `upsertItem` e `preview` leem
   `Feedback WHERE rubricId = ?` varrendo a tabela. As rotas de rubrica
   cresceram de 5× a 9×.
3. **Páginas de admin leem tabelas inteiras.** `POST /admin` foi de 5 para
   162 ms, `/admin/disciplines` e `/admin/editions` de 3 para 60–70 ms (o
   número de queries dobra, de 14 para 32). `course.findMany` sem filtro
   carrega todos os cursos com as matrículas
   (`Enrollment WHERE status = ? AND courseId IN (…)`, 37 ms) e
   `user.findMany` todos os usuários ordenados por `createdAt` (25 ms).
   Falta paginação, e contar em vez de carregar.
4. **`GET /api/course` e `GET /api/user` sem limite**: 28 ms e 13 ms com 300
   cursos e 5 mil usuários.
5. **Chaves estrangeiras sem índice** (achado ao escrever `test/fill/`):
   `Submission.questionId`, `QuestionsForExam.questionRefId`,
   `Rubric.questionRefId`, `AnswerEditField.questionId` e
   `QuestionRef.latestId`. Apagar um `QuestionRef` varre `Submission`: no
   preenchimento, inserir fora de ordem custou 45 s em vez de 7 s.
6. **P2029 do Prisma** (limite de parâmetros) em
   `answerEditField.findMany({ take: 2000, include: { batches } })`: um
   `include` sobre alguns milhares de pais estoura. Conferir os `include` das
   listas sem limite.
7. **`gradingJob.totals`** (linha periódica do log) custa 28 ms com 330 mil
   submissões, uma vez por minuto. Aceitável, mas `Submission.count()` pode
   sair se incomodar.

Fora do banco, visto no log da suíte: `GET /openapi.json` gasta ~460 ms de
CPU síncrona por chamada, sem cache.

## Falhas só no banco cheio

Três casos de `test/admin-form-errors.spec.ts` (formulário "add user", linhas
146, 184 e 206) falham por timeout no clique. Não investigado; a suspeita é a
página `/admin/users` com 5 mil linhas.

## Critérios de aceitação

- [x] `feedback.findMany` por curso não percorre `Feedback` inteira.
- [x] Índice em `Feedback.rubricId` e nas chaves estrangeiras do item 5.
- [ ] Listas de admin e `GET /api/course`, `/api/user` paginadas.
- [ ] `pnpm run test:perf` sem rota de curso acima de 2× e sem falhas só no
  banco cheio.

## Andamento

2026-11-14: itens 1, 2 e 5 feitos. `feedback.findMany` busca os ids com SQL
crua a partir das provas do curso (`feedbackIdsOfCourse`) e carrega as linhas
em blocos de 500. No banco cheio a consulta foi de 85 ms para menos de 1 ms, e
`test:perf` nos specs de rubrica, correção e notas não mostra rota acima de
2 ms de crescimento. Sobra um custo que segue o curso, não o banco: cada
feedback carrega prova, exceções e matrículas do curso, e listar 1033
feedbacks leva ~100 ms fora do SQLite. Faltam os itens 3 e 4 (paginação).

2026-11-14: `GET /api/course` e `GET /api/user` paginadas por cursor, com
envelope `{ items, next }` em todas as listas da API
(`dev/specs/to-do/paginacao-das-listas.md`). Faltam as páginas de admin e as
demais listas sem limite nas páginas, que dependem do componente de tabela
paginada.

2026-11-14: barra lateral, `/home` e `/calendar` filtram pelos cursos de que
o usuário participa; `/admin`, `/admin/disciplines` e `/admin/editions` contam
em vez de carregar (162 ms → 5–8 ms e 60–70 ms → 1–3 ms). `test:perf` nos
specs de admin ainda mostra `GET /admin/users` em 18 ms (15×), que lista os 5
mil usuários, e os três casos de `admin-form-errors` continuam falhando no
banco cheio. Os dois dependem da tabela paginada.
