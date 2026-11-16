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

Resolvido em 2026-11-15: com `/admin/users` paginada os três passam no banco
cheio. A suspeita ficou confirmada só por esse resultado; o clique em si não
foi perfilado.

## Critérios de aceitação

- [x] `feedback.findMany` por curso não percorre `Feedback` inteira.
- [x] Índice em `Feedback.rubricId` e nas chaves estrangeiras do item 5.
- [x] Listas de admin e `GET /api/course`, `/api/user` paginadas.
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

2026-11-15: `/admin/courses`, `/admin/users`, `/admin/disciplines`,
`/admin/editions` e `/courses` leem uma página de 50 linhas por cursor, e
`/admin` conta disciplinas e edições em vez de listá-las
(`dev/specs/to-do/paginacao-das-listas.md`, itens 4 a 8). `test:perf` em
`admin-guard`, `admin-form-errors` e `admin-list-pages`, 19 testes verdes nos
dois bancos, mediana de SQLite em ms (seed → cheio):

| Rota | seed | cheio | cresc. |
| :-- | --: | --: | --: |
| `GET /admin` | 1,4 | 4,2 | 3,0× |
| `GET /admin/users` | 1,1 | 2,4 | 2,2× |
| `GET /admin/courses` | 1,5 | 4,9 | 3,3× |
| `GET /admin/disciplines` | 1,2 | 1,2 | 1,0× |
| `GET /admin/editions` | 1,1 | 1,2 | 1,1× |
| `GET /courses` | 1,1 | 1,7 | 1,5× |

Nenhuma SQL lenta só no banco cheio. O que ainda cresce são as contagens
(`countByRole` sobre os 5 mil usuários, `course.count` e `course.countBy`),
na casa de poucos milissegundos; a rodada anterior deu 2,9 ms em
`/admin/courses`, então a diferença entre 1,9× e 3,3× ali é ruído. Em `/admin`
os convites pessoais ainda são carregados e filtrados em JS. Falta rodar o
`test:perf` inteiro: um spec que cria uma linha e a procura na primeira
página de uma dessas listas pode falhar só no banco cheio, como aconteceu
com o caso do diálogo de disciplina em `admin-form-errors`, que agora abre a
página pelo cursor da linha.

2026-11-16: questões do professor e filas de relatos paginadas; `main`
rebaseada sobre o remoto. `test:perf` inteiro: de 249 rotas, 3 crescem 2× ou
mais, todas abaixo de 7 ms no banco cheio (`GET /<curso>/attendance` 1,5 → 5,7
ms, `POST /admin` 2,6 → 6,3 ms, `GET /api/user` 0,5 → 1,0 ms). Em 2026-11-14
eram 19, com picos de 100 a 200 ms.

A rodada achou uma consulta nova, vinda com a correção automática de
objetivas: `response.settleExpired`, ao abrir a prova do professor, levava
86,6 ms no banco cheio porque `feedbacks: { none: {} }` do Prisma agrega
`Feedback` inteira. Trocada por SQL crua que percorre só as tentativas da
prova; `GET /<curso>/exams/<prova>` ficou em 6,5 → 6,3 ms, sem SQL lenta.

Falhas só no banco cheio: dois testes de `test/api-crud.spec.ts` supunham
banco pequeno (corrigidos); `exam-answer-edit-isolation.spec.ts:483` e
`exam-delivery.spec.ts:247` falharam na rodada inteira e passam sozinhos no
banco cheio, então são instabilidade sob carga, não custo de consulta.

Falta para o critério ao pé da letra: `/attendance` (3,8×) e `POST /admin`
(2,4×). Sobram também `/roster`, `/resources`, `/exams` e o intervalo de
datas do `/calendar`, que seguem o tamanho do curso e não o do banco.
