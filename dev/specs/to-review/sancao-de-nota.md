---
type: spec
status: to-review
tags: [grading, exams, audit]
relatedTo: [regrade-requests, course-grade, anular-questao]
created: 2026-11-17
creator: claude
---

# Sanção de nota: zerar ou reduzir a nota de um aluno numa prova

## Contexto

Quando o professor pega cola ou outro problema grave, precisa zerar a nota de
um aluno numa questão ou na prova inteira. Hoje o único meio é escrever um
`Feedback` com `score: "0"`, que vale enquanto for o pass mais novo
(`src/services/exam-result.ts`, `outcomeOf`): uma recorreção do worker, uma
mudança de rubrica ou um pedido de revisão aceito desfaz o zero. A prova
inteira não tem como ser zerada, e não fica registro de quem decidiu, por quê
e com que evidência.

A sanção é individual. Anular uma questão para a turma toda é outra
funcionalidade (`dev/issues/anular-questao.md`).

## Glossário

- **Sanção** (`ExamSanction`): decisão do professor de zerar ou reduzir a nota
  de um aluno numa questão ou no total de uma prova. Aplicada por cima de toda
  correção; revogável. Só sai do banco junto com a tentativa (R7a).

## Requisitos

### Banco

- R1. Model novo (`prisma/schema.prisma`), relações inversas em `Response`,
  `QuestionRef` e `User`:

  ```prisma
  /// An instructor's decision to cancel or reduce one student's score on an
  /// exam, or on one question of it, for misconduct or another problem. Applied
  /// on top of every grading pass, so regrading never undoes it.
  model ExamSanction {
    id       Int    @id @default(autoincrement())
    publicId String @unique

    /// The sanctioned attempt.
    responseId Int
    response   Response @relation(fields: [responseId], references: [id], onDelete: Cascade)

    /// The question whose score is affected. Null affects the exam total.
    questionRefId Int?
    questionRef   QuestionRef? @relation(fields: [questionRefId], references: [id], onDelete: Cascade)

    /// Multiplier on the score, a decimal string in [0, 1). "0" zeroes it.
    factor String @default("0")

    /// Shown to the student. Optional.
    reason String?

    /// Instructor-only free text: evidence, how it was caught, who else took part.
    notes String?

    createdById String
    createdBy   User   @relation("SanctionCreatedBy", fields: [createdById], references: [username])

    /// Set when the sanction was lifted. The row stays as a record.
    revokedAt   DateTime?
    revokedById String?
    revokedBy   User?   @relation("SanctionRevokedBy", fields: [revokedById], references: [username])

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    @@index([responseId])
  }
  ```

- R2. A sanção se prende à tentativa (`Response`), não a prova × aluno (D1).
  Aluno sem tentativa já tem total zero.
- R3. Uma linha por aluno; cola em grupo cria uma linha por aluno com o mesmo
  `reason` e as mesmas `notes` (D2).
- R4. Revogar grava `revokedAt`/`revokedById` e mantém a linha. No máximo uma
  sanção ativa por (tentativa, questão ou prova); garantido pelo service, não
  por índice único (J2).
- R5. Uma sanção cuja questão saiu da prova num push fica no banco e é ignorada
  no cálculo (J4).

### Entidades

- R6. Schemas em `src/core/schemas/exam-sanction.ts`, exportados por
  `src/core/schemas/index.ts`:
  - `examSanctionSchema` (leitura de staff): `id`, `publicId`, `response`
    (publicId), `exam` (slug), `author` (username do aluno), `question` (slug
    ou `null`), `factor`, `reason`, `notes`, `createdBy`, `createdAt`,
    `revokedAt`, `revokedBy`.
  - Leitura do aluno: a mesma sem `notes`, `createdBy` e `revokedBy` (J19).
  - `examSanctionCreate`: `usernames` (≥ 1), `question?`, `factor` (padrão
    `"0"`), `reason?`, `notes?`.
  - `examSanctionUpdate`: `factor`, `reason`, `notes`, todos opcionais.
  - `sanctionFactor`: string decimal em `[0, 1)`. `reason` e `notes`: trim, até
    2000 caracteres, vazio vira `null`.
- R7. Service `src/db/services/exam-sanction.service.ts`, seguindo os ADRs 0004
  a 0006 e o RFC `como-criar-e-escrever-um-service`:
  - `create(exam, body)`: uma sanção por aluno, numa transação. Recusa tudo (nada
    gravado) se algum aluno não tem tentativa, se a tentativa é `preview`, se a
    prova é `PRACTICE`, se a questão não está na prova ou se já há sanção ativa
    no mesmo alvo.
  - `update(id, body)`: só sanção ativa.
  - `revoke(id)`: grava autor e momento; revogar de novo é erro.
  - `findMany({ course, exam?, author?, revoked? })`: uma query por loader,
    devolvendo `response` como `publicId`, para os loaders montarem um
    `ReadonlyMap<responsePublicId, ResultSanction[]>` sem N+1.
  - Leitura pelo aluno remove `notes`, `createdBy`, `revokedBy` e esconde
    revogadas e não liberadas (R17).
- R7a. `response.delete` (`src/db/services/response.service.ts`) recusa (409)
  tentativa com sanção ativa; revogada sai em cascata com a tentativa (J23).
- R8. A sanção não fecha a tentativa (J11). Numa tentativa aberta a linha segue
  "in-progress", sem total.

### Nota

- R9. `examResult` (`src/services/exam-result.ts`) recebe as sanções ativas da
  tentativa (`ResultSanction[]`: `question: slug | null`, `factor`, `reason`)
  num parâmetro **obrigatório** (J6). As 12 chamadas atuais:
  - Recebem sanções, carregadas por um `db.examSanction.findMany` no
    `Promise.all` que o loader já tem: `src/utils/load-exam-staff.ts`,
    `load-instructor-home.ts`, `load-student-home.ts`, `load-attempt-view.ts`,
    `src/pages/[discipline]/[course]/exams/index.astro`,
    `exams/[slug]/attempts/[username].astro`, `attemptRows` em
    `src/services/grading.ts`, `exam.service` (`attemptResults`) e
    `regrade-request.service`.
  - Recebem lista vazia fixa: `codeAnswer` em `src/services/grading.ts` (senão
    a questão `code` zerada some da fila de correção, contra R23),
    `grading-job.service.ts` e `scoreRows` em `src/services/question-stats.ts`
    (R14b).
  - As funções puras (`attemptRows`, `gradesTable`) recebem
    `ReadonlyMap<responsePublicId, ResultSanction[]>`; `GradingAttempt`
    (`src/services/grading.ts`) ganha `publicId`.
- R10. Questão sancionada: status `sanctioned`, `score = original × factor`.
  Com fator 0, o score é 0 mesmo sem correção e a questão não é pendente
  (J7). Com fator > 0 e sem nota, a questão segue `pending` (score `null`)
  com `sanction` preenchido; vira `sanctioned` quando a nota chega.
- R10a. Questão `code`: o fator incide sobre a nota final já descontada;
  `codeAttempts` fica intacto. Com fator 0 e envio aguardando o worker, vira
  `sanctioned` com 0, e o job segue na fila.
- R11. Prova sancionada: `total × factor`. Com fator 0, o total é 0 mesmo com
  questões pendentes; com fator > 0, o total segue `null` enquanto houver
  pendência (J8). Sanção de questão e de prova na mesma tentativa se compõem.
- R11a. `ExamResult` ganha `pending: number`: questões pendentes, sem contar
  as sancionadas com nota fixada, e 0 com prova em fator 0. `attemptRows`
  (`src/services/grading.ts`), `gradesTable` (`src/services/grades-table.ts`)
  e `pendingAnswerCount` (`src/services/exam-state.ts`) passam a ler dali, e
  não de `countingAnswers`. Assim, aluno zerado com resposta sem nota não
  trava a liberação de notas (`exam.release-grades`) nem mostra "pendente" na
  tabela.
- R12. Nota negativa não é multiplicada, nem na questão nem no total:
  `x > 0 ? x × factor : x` (J9).
- R13. `QuestionOutcome` e `ExamResult` ganham
  `sanction?: { factor, reason, original: { status, score } }` (J10). O aluno
  também recebe `original`, porque `blanks` e `rubricItems` já a revelam.
  Pontos que ramificam por status e precisam tratar `sanctioned`:
  `src/utils/load-review.ts`, `src/components/exam/ExamAttempt.tsx` (o
  `Switch` de status do resultado) e `exams/[slug]/attempts/[username].astro`.
- R14. Blocker novo `sanctioned` em `regradeBlocker` (`src/services/regrade.ts`),
  depois de `not-released` e antes de `not-counting`. `RegradeContext` ganha
  `examSanctioned`; `contestedSelect` em `regrade-request.service` carrega as
  sanções ativas da tentativa, e `load-attempt-view.ts` passa o mesmo
  contexto. Pedido já aberto continua; aceitá-lo muda só a nota original
  (J12).
- R14b. As estatísticas de questão (média, acertos, discriminação) usam a nota
  original: elas medem a questão, não a conduta. A tabela de notas do curso e
  o CSV usam a nota sancionada.

### REST e permissões

- R15. Rotas sob `/api/course/[discipline]/[course]/exam/[slug]/`:

  | Método | Rota | Faz |
  | :-- | :-- | :-- |
  | GET | `sanction` | Lista; `?revoked=true` inclui revogadas (só staff) |
  | POST | `sanction` | Cria em lote; 201 com a lista criada |
  | GET | `sanction/[id]` | Lê uma (`publicId`) |
  | PATCH | `sanction/[id]` | Edita `factor`, `reason`, `notes` |
  | POST | `sanction/[id]/revoke` | Revoga (J13) |

- R16. Permissões `exam-sanction.*` em `src/auth/permissions/index.ts`:

  | Ação | Admin | Instrutor do curso | Aluno | SYSTEM / bot |
  | :-- | :-- | :-- | :-- | :-- |
  | `create` / `update` / `revoke` | ❌ | ✅ | ❌ | ❌ |
  | `read` completo (notas, autor, revogadas) | ❌ | ✅ | ❌ | ❌ |
  | `read` das próprias, sem notas | | | só ativas e liberadas | |

  Mesma regra de `feedback.create` (J1, J22): só o instrutor do curso, com
  `system: false` explícito, porque bot nunca sanciona (J16).
- R17. O aluno vê a sanção quando vê a nota (D4), pela mesma regra de
  `feedback.read` (`releasedToStudents` em `src/db/services/feedback.service.ts`,
  que já considera exceções). Não reescrever a regra. Antes disso a sanção não
  existe para ele: lista vazia, 404 por id (J17).
- R18. Astro Actions finas em `src/actions/exam-sanction.ts`: `create`,
  `update`, `revoke` (J15).
- R19. Na prática, o único endpoint REST que já devolve nota é a tabela de notas
  (`courseGradesSchema`): a célula `total` ganha `sanction?`. Regerar com
  `pnpm run openapi:cli` (J14, J20).

### Telas

- R20. `exams/[slug]/results.astro` (`ExamResults`): checkbox por linha e botão
  **Sancionar selecionados**, que abre um diálogo com alvo (prova inteira ou uma
  questão), fator (só com alvo prova, padrão 0), motivo para o aluno e notas
  privadas (textarea). Total sancionado em vermelho com o original riscado
  (J18).
- R21. Página nova `exams/[slug]/sanctions.astro` (D5): lista as sanções
  ativas e revogadas (aluno, alvo, fator, motivo, notas, autor, data), edita
  motivo, notas e fator (fator só para prova) e revoga. Item no `examNav` com
  o contador de sanções ativas.
- R22. `exams/[slug]/attempts/[username].astro`: faixa no topo com a sanção da
  prova (motivo, notas, link para R21); **Zerar questão** em cada questão e
  badge "Zerada"; **Sancionar prova** para este aluno.
- R23. `grading/[question].astro`: badge "Zerada" na resposta sancionada. A
  correção continua permitida.
- R24. `grades.astro` (`GradesTable`): célula da prova sancionada em
  `text-error` com ícone e `title` (motivo e fator). O CSV exporta a nota
  sancionada.
- R25. Aluno, em `exams/[slug].astro`: depois da liberação, alerta "Sua nota
  nesta prova foi zerada" (ou "reduzida a X%") com o motivo, se houver; badge
  "Zerada" na questão sancionada. Total e home do aluno já vêm sancionados por
  R9.
- R26. Textos novos em i18n (pt-BR e en).

### CLI

- R27. Sem comando novo. Só o snapshot OpenAPI e `cli/codehood/api/generated.py`
  regenerados (J20).

### Dados de dev

- R28. `src/db/bootstrap.ts`, sem prova nova:

  | Prova | Estado |
  | :-- | :-- |
  | `test-01` (`EXAM`, liberada) | Dois alunos com sanção da prova, fator 0, mesmo motivo e notas, num só `create` |
  | `test-01` | Terceiro aluno com uma questão zerada |
  | `test-01` | Quarto aluno com sanção revogada |
  | `test-02` (`EXAM` em correção) | Sanção da prova com fator 0.5 em aluno com questão pendente; questão zerada em resposta sem nota de outro aluno |
  | `quiz-01` (`QUIZ` fechado) | Uma questão zerada |

- R29. `GLOSSARY.md` ganha **Sanção** (J5).

## Fora do escopo

- Tela de fator para questão (só via REST; a tela usa fator 0).
- Comandos de sanção na CLI.
- Sugerir suspeitos a partir do histórico de edição ou do colar na prova.
- Anular questão para a turma (`dev/issues/anular-questao.md`).
- Histórico geral de alterações de nota (`dev/issues/historico-de-notas.md`).

## Plano de ação

- T1. Schema (`haiku`). `prisma/schema.prisma`, `prisma db push`,
  `pnpm run db:reset`. R1. Pronto: `pnpm run typecheck` sai 0.
- T2. Regras puras (`sonnet`, TDD). `src/services/exam-result.ts`
  (`examResult`, `ResultSanction`, `pending`), `regradeBlocker` em
  `src/services/regrade.ts`, `attemptRows` em `src/services/grading.ts`,
  `gradesTable` em `src/services/grades-table.ts`, `pendingAnswerCount` em
  `src/services/exam-state.ts`. As 12 chamadas de `examResult` passam lista ou
  mapa vazio até T3. R9 a R14b. Depende de T1. Pronto: specs unit de R10 a
  R12, R11a e R14 passando; typecheck 0.
- T3. Schemas, service, permissões e loaders (`sonnet`, TDD).
  `src/core/schemas/exam-sanction.ts`, `exam-sanction.service.ts`, registro em
  `src/db`, `src/auth/permissions/index.ts`, `response.service` (R7a),
  `contestedSelect` em `regrade-request.service`, e os loaders da lista de R9,
  que trocam o vazio de T2 pelas sanções reais. R2 a R8, R7a, R16, R17.
  Depende de T2. Pronto: specs unit de cada recusa de `create`, da revogação,
  da visibilidade para o aluno, do bloqueio de revisão com sanção da prova, de
  R7a, e de liberar notas com aluno zerado e resposta pendente.
- T4. REST e Actions (`sonnet`). `src/api/index.ts`, `src/actions/`,
  `pnpm run openapi:cli`. R15, R18, R19, R27. Depende de T3. Pronto: spec e2e
  da REST com instrutor, aluno (antes e depois da liberação) e chave de bot;
  `test/openapi-snapshot.spec.ts` e `cli/tests/test_generated_in_sync.py`
  passando.
- T5. Histórias (`sonnet`). Professor: tenta sancionar sem selecionar ninguém,
  sanciona dois alunos pela tela de resultados, zera uma questão na tentativa,
  edita notas, revoga, vê a célula vermelha nas notas do curso. Aluno: não vê
  nada antes da liberação, vê o alerta e o motivo depois, não consegue pedir
  revisão. Antes de T6 e T7. Depende de T4.
- T6. Telas do professor (`sonnet`). R20 a R24, R26. Depende de T4, T5.
  Pronto: histórias de professor passando.
- T7. Tela do aluno (`sonnet`). R25, R26. Depende de T4, T5. Pronto: história
  de aluno passando.
- T8. Seed e glossário (`haiku`). R28, R29. Depende de T3. Pronto:
  `pnpm run db:reset` e cada estado visível no dev server.

Fechamento: `pnpm exec biome check --write .`, `pnpm run lint`, `pnpm test`,
changelog, spec para `to-review/`.

## Critérios de aceite

- Specs unit de R10 a R12 (fator 0 com pendência, fator 0.5, score negativo) e
  das recusas de R7 passando.
- Uma recorreção (feedback novo) numa questão zerada não muda a nota.
- Questão `code` zerada continua na fila de correção; célula da tabela de notas
  com questão zerada sem nota mostra o total, não "pendente"; liberar notas
  com aluno zerado e resposta pendente funciona.
- No dev server, `test-01`: tela de resultados com totais em vermelho, página
  de sanções com ativa e revogada, célula vermelha em `grades.astro`; logado
  como aluno sancionado, o alerta com o motivo e sem as notas privadas.
- `test-02` logado como aluno sancionado: nenhum sinal da sanção.
- Screenshots das telas de R20, R21, R24 e R25.
