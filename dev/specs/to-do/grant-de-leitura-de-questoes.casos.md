# Casos de teste: grant de leitura de questões (T2 e T3)

Lista do projetista de testes para `grant-de-leitura-de-questoes.md`. Cada
caso vira um `test(...)` (ou poucos `test.step`) no arquivo indicado. Todos os
casos são `unit`: nenhum toma `page`, `request`, `browser` ou `context`.

## Convenções de arrange

Valem para os dois arquivos. Os helpers ficam no topo de cada spec.

- **Curso, aluno e instrutor.** `makeCourse()`, `enroll(course.id)`,
  `actorOf(user)` e `tag(prefix)`, de `test/conditional-write-exam-support.ts`.
  Instrutor age com `actorOf(instructor)`; leitura de sistema com
  `FULL_ACCESS`.
- **Questão com versão.** `db.question.create({ course, slug, status:
  "PUBLISHED", version: "v1", question: doc }, FULL_ACCESS)`. Para as provas
  de validação e nota, use um documento de múltipla escolha escrito no teste,
  no molde de `capitalChoice` (`src/mdq/fixtures.ts`), com `id` de escolha
  conhecido.
- **Push de versão nova.** `db.question.update({ course, slug }, { version:
  "v2", question: docV2 }, FULL_ACCESS)`. Isso cria a `QuestionData` `v2` e
  move `QuestionRef.latestId`; a `v1` fica no banco.
- **Questão sem nenhuma versão.** `prisma.questionRef.create({ data: {
  publicId: tag("p"), slug: tag("q-"), courseId, type: "MULTIPLE_CHOICE" } })`,
  com `latestId` nulo.
- **Prova com pins.** `db.exam.create({ course, slug: tag("exam-"), type,
  status, scheduledAt, duration, questions: [{ slug, version }] },
  actorOf(instructor))`. `version` omitido grava pin nulo. Para ligar questões
  sem passar pelo service (questão sem versão, prova antiga), use
  `prisma.questionsForExam.createMany` como em `persistedOpenExam`.
- **Prova antiga (sem congelamento).** Crie a prova com pin nulo, e a
  tentativa por `prisma.response.create({ data: { publicId: tag("r"),
  authorId, examId, slotKey: 0, preview: false } })`, que não passa pelo
  congelamento. `questionsFrozenAt` fica nulo.
- **Tentativa do aluno.** `db.response.create({ course, exam }, actorOf(student))`
  ou, para o caminho `resolveOrCreateAttempt`, `db.response.answer({ course,
  exam, question, payload }, actorOf(student))` sem tentativa prévia. Entrega:
  `db.response.finish({ course, exam }, actorOf(student))`.
- **Simulação.** As mesmas chamadas com `actorOf(instructor)` e sem `author`.
- **Tempo.** Prefira o `now` injetado: `issueExamGrant(tx, target, actor,
  now)`, `grantViews(..., now)` e `assertExamGrant(grant, actor, now)`. Crie a
  prova aberta no relógio real (por exemplo `scheduledAt = agora - 10 min`,
  `duration: { minutes: 60 }`), crie as tentativas e emita com `now`
  adiantado. Quando um service sem `now` precisar ver a prova encerrada
  (`releaseGrades`, `attemptOrEmpty`), encerre com `db.exam.close(pk,
  actorOf(instructor))` ou mova as datas com `prisma.exam.update({ where: { id
  }, data: { scheduledAt: agora - 3 h } })`.
- **Exceção.** `db.examException.create({ course, exam, username, extraTime,
  scheduledAt }, actorOf(instructor))`; remoção com `db.examException.delete({
  course, exam, username }, actorOf(instructor))`.
- **Desmatrícula.** `db.enrollment.delete({ course, username }, FULL_ACCESS)`.
- **Liberação.** `db.exam.releaseGrades(pk, actorOf(instructor))`. Só libera
  `EXAM` encerrada sem resposta pendente: o aluno não responde nada ou
  responde só questão objetiva.
- **Tentativa vazia.** Dentro de `prisma.$transaction(tx => attemptOrEmpty(tx,
  { examId, author, createdBy: instructor.username, now: new Date(), field:
  "author", requireFinished: false }))`.
- **Ler o pin e o carimbo.** `prisma.questionsForExam.findMany({ where: {
  examId }, orderBy: { position: "asc" } })` e `prisma.exam.findUnique({
  where: { id } })`. Para comparar `dataId`, leia `prisma.questionData` por
  `{ refId, versionHash }`.
- **Nota.** Leia as submissões e os feedbacks como `stored()` em
  `test/objective-grading.spec.ts`.
- **Emitir num teste.** `issueExamGrant` e os leitores recebem `tx`: passe
  `prisma` ou rode dentro de `prisma.$transaction`.

## T2. `questionsFrozenAt` e congelamento

Arquivo: `test/exam-freeze.spec.ts`. Escopo: `unit`.

| # | Cenário (arrange) | Ação | Esperado | R | Falha hoje? |
| :-- | :-- | :-- | :-- | :-- | :-- |
| F1 | Prova `EXAM` `ONGOING` com três questões: `q1` fixada em `v1` e com push de `v2`; `q2` sem pin e com push de `v2`; `q3` sem nenhuma versão (`prisma.questionRef.create`, ligada por `prisma.questionsForExam.createMany`). Dois alunos matriculados | `db.response.create` do aluno A; leitura das linhas e da prova; depois `db.response.create` do aluno B; `db.exam.findOne(pk, actorOf(instructor))` | Depois de A: `q1=v1`, `q2=v2`, `q3=null`, `questionsFrozenAt` entre o antes e o depois da chamada. Depois de B: `questionsFrozenAt` igual ao de A. `findOne` do instrutor devolve `questionsFrozenAt` e o pin real de cada questão (`q2` com `version: "v2"`) | R3, R5, R12 | Sim: a coluna e o congelamento não existem |
| F2 | Prova `ONGOING` com `q1` sem pin. `v1` é múltipla escolha com as escolhas `a` (certa) e `b` | O aluno chama `db.response.answer` com `a`, sem tentativa prévia (caminho `resolveOrCreateAttempt`). O instrutor faz push de `v2`, com as escolhas `b` (certa) e `z` (nova). O aluno responde `a` de novo, depois tenta `z`, e chama `finish` | O pin de `q1` é `v1`. A resposta `a` é aceita e `z` é recusada com `InvalidData`. Depois do `finish`, a nota da última resposta de `q1` é a de `a` pela chave de `v1` (nota máxima) | R5, R10 | Sim: sem pin, a prova segue a última versão e valida e corrige pela `v2` |
| F3 | Prova `ONGOING` com `q1` sem pin, sem tentativas; `v1` não tem a escolha `z` | Push de `v2` com a escolha `z`; o aluno chama `db.response.answer` com `z` | Resposta aceita; o pin passa a ser `v2` | R10 | Em parte. A aceitação já passa hoje e fica como regressão contra congelar cedo demais (no push ou ao abrir a prova). O pin falha |
| F4 | Quatro provas, cada uma com uma questão sem pin, sem tentativas e com um aluno matriculado: (a) `EXAM` `SCHEDULED` com `scheduledAt` 3 h atrás e 60 min de duração; (b) igual a (a); (c) `EXAM` `ONGOING`; (d) `EXAM` `ONGOING` | (a) `attemptOrEmpty` para o aluno; (b) `db.exam.releaseGrades`; (c) `db.exam.close`; (d) `db.exam.update(pk, { status: "COMPLETED" }, actorOf(instructor))` | Nas quatro: pin = `versionHash` da última versão, e `questionsFrozenAt` preenchido | R5, R6 | Sim |
| F5 | Prova `ONGOING` com `[q1 sem pin, q2]`, congelada por `db.response.create` do aluno (q1 fica em `v1`). Depois, push de `v2` em `q1` e uma `q3` nova com versões `v1` e, por push, `v4` | `db.exam.upsert({ course, slug, ..., questions: [{ slug: q3 }, { slug: q1, version: "v2" }] }, actorOf(instructor))` | Sem erro. `q3` na posição 0 com pin `v4`; `q1` na posição 1 com pin `v1`; `q2` sai da prova | R11 | Sim: hoje `deleteMany`/`create` grava `q1=v2` e `q3=null` |
| F6 | Prova `PRACTICE` com `q1` sem pin, versão `v1` sem a escolha `z` | O aluno cria a tentativa com `db.response.create` e responde com `answer`. Push de `v2` com a escolha `z`. O aluno responde `z` | `questionsFrozenAt` nulo e pin nulo depois de cada passo; a resposta `z` é aceita | R7 | Só na leitura de `questionsFrozenAt`. O resto é regressão contra congelar prática |
| F7 | Prova `ONGOING` com `q1` sem pin | O instrutor faz `db.response.create` (simulação), `db.response.answer` e `db.response.restartPreview`; leitura. Depois um aluno faz `db.response.create`; leitura | Depois da simulação: `questionsFrozenAt` nulo e pin nulo. Depois do aluno: pin preenchido e `questionsFrozenAt` preenchido | R8, R5 | Sim (a coluna). A parte da simulação é regressão |
| F8 | Prova `ONGOING` com `q1` sem pin, congelada pelo `db.response.create` de um aluno (pin `v1`). Via `prisma.exam.update`, `questionsFrozenAt` volta a nulo, como uma transação concorrente que leu a prova antes do carimbo. Push de `v2` | `freezeQuestionVersions(prisma, exam.id)` | O pin continua `v1`: o `updateMany` com `version: null` no `where` não sobrescreve. `questionsFrozenAt` é preenchido de novo | R4, R3 | Sim: a função não existe |

## T3. Grant: emissão, verificação e leitores

Arquivo: `test/exam-grant.spec.ts`. Escopo: `unit`. Todos os casos falham
hoje porque `issueExamGrant`, `grantViews`, `assertExamGrant`,
`grantedQuestions`, `grantedDocument` e `freezeQuestionVersions` ainda não
existem em `src/db/services/exam-questions.ts`. A coluna "Bug que pega" diz o
que o caso prende depois que as funções existirem.

Salvo indicação, `target` é `{ course: course.id, exam: exam.slug }`. A prova
padrão é `EXAM` `SCHEDULED`, com `scheduledAt` 10 min atrás e 60 min de
duração.

| # | Cenário | Ação | Esperado | R | Bug que pega |
| :-- | :-- | :-- | :-- | :-- | :-- |
| G1 | Aluno com tentativa `in-progress`; um colega matriculado | `issueExamGrant` com `SYSTEM` e `target`; com `actorOf(instructor)` e `{ response: tentativa.publicId }`; com o colega e `{ response: tentativa.publicId }` | `null` nos três | R19 (linha 1) | Instrutor ou `SYSTEM` recebendo grant de aluno por terem `course.read-contents` |
| G2 | Prova com `scheduledAt` amanhã | `issueExamGrant` do aluno | `null` | R19 (`not-open`) | Grant antes da abertura |
| G3 | Prova padrão, aluno sem tentativa | `issueExamGrant` do aluno | `null` (B6) | R19 (`can-start`) | Leitura do enunciado antes de iniciar o relógio |
| G4 | Prova padrão com `q1` e `q2` criadas nessa ordem e ligadas como `questions: [q2, q1]`. `q1` tem pin `v1` e push de `v2`; `q2` sem pin. Aluno `in-progress` | `issueExamGrant(prisma, target, aluno, t)` com `t = new Date()`; `grantedQuestions(prisma, grant, aluno)` | `view: "answer"`, `answering: true`, `responseId` da tentativa e `expiresAt = t + 60 s`. `questions` = `[q2, q1]`, com `q2` no `dataId` da última versão e `q1` no `dataId` de `v1`. `grantedQuestions` vem na mesma ordem, com o enunciado de `v1` em `q1` e sem campo privado (nenhum `score` nas escolhas) | R19, R17, R22, R23 | Ordem pelo `id` da consulta em vez da ordem da prova; queda para a última versão com pin; vazamento da metade privada |
| G5 | C5, três mundos com o aluno `in-progress` e um grant emitido: (a) `db.exam.update(pk, { status: "ARCHIVED" })` e, num quarto mundo, `{ status: "DRAFT" }`; (b) prova com `scheduledAt` amanhã e exceção do aluno com `scheduledAt` 10 min atrás, tentativa criada; depois `db.examException.delete`; (c) `db.enrollment.delete` do aluno. Mais um usuário de fora do curso, com o `target` de (a) antes do arquivamento | Nova `issueExamGrant` em cada mundo e com o usuário de fora | `null` em todos | R19 (linhas 2 e 3), R17 | Cache entre chamadas; arquivamento, exceção removida ou desmatrícula ignorados |
| G6 | Segunda chamada com a turma encerrada pelo relógio: prova com `scheduledAt` 3 h atrás e 60 min de duração. (a) Exceção do aluno com `scheduledAt` amanhã, sem tentativa. (b) Exceção com `scheduledAt` 10 min atrás; o aluno cria a tentativa com `db.response.create` | (a) Emitir agora. (b) Emitir com `now = agora` e com `now = agora + 2 h` | (a) `null`. (b) Agora: `answer` com `answering: true`. Em +2 h: `answer` com `answering: false`, já que o prazo vence com `acceptingSubmissions` ainda verdadeiro | R19 | Usar a fase da turma em vez da fase pessoal; derivar `answering` de `acceptingSubmissions` |
| G7 | Só tempo extra: prova padrão; o aluno com exceção `extraTime: { minutes: 30 }`, `scheduledAt` nulo; o colega sem exceção. Os dois criam tentativa | Emitir para os dois com `now = agora + 55 min` (a turma fecha em +50 min). Depois `db.exam.close` e emitir de novo para o aluno com o mesmo `now` | Aluno: `answering: true`. Colega: `answering: false`. Depois do `close`: aluno com `answering: false`, porque tempo extra não reabre `COMPLETED` | R19 | Ignorar a exceção de tempo extra, ou deixar que ela reabra a prova encerrada à mão |
| G8 | (a, b) Prova padrão `EXAM`; o aluno cria a tentativa e chama `finish` sem responder; `db.exam.close`. (c) `QUIZ` padrão; o aluno cria a tentativa e chama `finish`; o colega tem exceção com `scheduledAt` 1 h no futuro | (a) Emitir. (b) `releaseGrades` e emitir. (c) Emitir com `now = agora + 55 min` (turma encerrada, segunda chamada do colega `upcoming`) e com `now = agora + 3 h` | (a) `answer`, `answering: false`. (b) `review`. (c) Em +55 min: `answer`; em +3 h: `review` | R19 (`submitted`, `results`), R21 | Liberação calculada só com a exceção do ator |
| G9 | Faltante: prova padrão `EXAM`, aluno sem tentativa, `db.exam.close` | Emitir; `releaseGrades`; emitir; `grantedQuestions` | Antes: `null`. Depois: `answer`, `responseId: null`, `answering: false`, todas as questões da prova; `grantedQuestions` devolve os enunciados | R19 (faltante), R39 | Faltante lendo antes da liberação ou ficando sem leitura depois |
| G10 | Tentativa vazia: prova padrão `EXAM`, aluno sem tentativa, `db.exam.close`; `attemptOrEmpty` cria a tentativa vazia | Emitir; `releaseGrades`; emitir | Antes: `null`, mesmo com uma tentativa fechada existindo (pela tabela crua seria `submitted`, ou seja `answer`). Depois: `review` | R20 | Tratar a tentativa vazia como entrega do aluno |
| G11 | Simulação: prova `DRAFT` com `q1` sem pin | O instrutor emite sem tentativa; faz `db.response.create` e emite; faz `db.response.finish` e emite | `null`; `answer` com `answering: true`; `review`. `questionsFrozenAt` continua nulo e o pin continua nulo | R19 (simulação), R8, R9 | Recusar simulação em `DRAFT`; congelar na emissão da simulação |
| G12 | `PRACTICE` com `q1` sem pin (`v1`). (a) O aluno cria a tentativa com `db.response.create`. (b) Outro aluno tem duas tentativas: uma com `practiceSession` 2 dias atrás, entregue por `prisma.response.update` com `acceptingSubmissions: false` e `closedAt`, e outra criada agora. (c) Um terceiro aluno só tem a tentativa de 2 dias atrás | (a) Emitir; push de `v2`; emitir. (b) Emitir. (c) Emitir | (a) 1º grant: `answer`, `answering: true`, `dataId` de `v1`; 2º: `dataId` de `v2`; `questionsFrozenAt` nulo. (b) `responseId` da tentativa criada agora, `answering: true`. (c) `null`, já que não há tentativa dentro de `PRACTICE_SESSION_WINDOW_MS` | R7, R9, R22 | Congelar prática; escolher a tentativa mais antiga ou fora da janela |
| G13 | B1: `q` com `v1` e push de `v2`. `QUIZ` padrão com `q` em `v1` e uma questão `outra` fora dele; o aluno cria a tentativa e chama `finish`; prova movida 3 h para trás por `prisma.exam.update`. `EXAM` com `scheduledAt` amanhã e `q` em `v2` | Grant do quiz; `grantedQuestions`; `grantedDocument(prisma, grant, aluno, q.slug)`; `grantedDocument` com `outra.slug`. Grant da `EXAM`. Depois `prisma.exam.update` da `EXAM` para `scheduledAt` 10 min atrás, `db.response.create` do aluno e novo grant | Quiz: `dataId` de `v1`, enunciado de `v1`, documento privado de `v1` (com a chave). `outra.slug` rejeita com `NotFound`. `EXAM` agendada: `null`. Depois de aberta: `dataId` de `v2`, diferente do de `v1` | R22, R18 | Liberação por questão em vez de por versão; `grantedDocument` lendo fora do grant |
| G14 | Prova padrão com `q1` fixada em `"v9"`, que não existe, e `q2` em `v1`; aluno `in-progress` | Emitir; `grantedQuestions` | `questions` e `grantedQuestions` só com `q2`; nada de `q1`, nem da última versão dela | R22 | Queda para a última versão quando o pin não existe |
| G15 | Prova antiga (ver convenções): `EXAM` padrão, `q1` sem pin com `v1`, tentativa criada por `prisma`, `questionsFrozenAt` nulo | Emitir; push de `v2`; emitir de novo | 1º grant com `dataId` de `v1`; no banco, pin `v1` e `questionsFrozenAt` preenchido. 2º grant ainda com `dataId` de `v1` | R9 | Prova antiga seguindo a última versão para sempre |
| G16 | Aluno `in-progress`, grant emitido com `now = t`. Outro grant emitido com `now = agora - 61 s` | `assertExamGrant` com o aluno em `t + 59 999 ms` e em `t + 60 000 ms`; com o colega em `t`; com `SYSTEM` em `t`. `grantedQuestions(prisma, grantVencido, aluno)` | Só a primeira chamada passa. As outras lançam `ImproperBehavior`; `grantedQuestions` rejeita com `ImproperBehavior` antes de ler | R16, R17, R18 | Validade com `<=`; grant aceito para outro ator |
| G17 | Aluno `in-progress`, grant real `g`; uma segunda prova do mesmo curso | `assertExamGrant`, `grantedQuestions` e `grantedDocument` com `{ ...g }`, `structuredClone(g)`, `Object.assign({}, g)` e um literal com os mesmos campos, ids via `unsafeBrand` e `as unknown as ExamGrant`. Atribuir `g.examId` com o id da segunda prova; `g.questions.push(...)`; atribuir `g.questions[0].dataId` | Todas as chamadas com cópia ou literal lançam `ImproperBehavior`. As três mutações lançam `TypeError`. Depois delas, `grantedQuestions(g)` ainda devolve as questões da prova original | R15, R16, R18 | Verificação só pelo formato; congelamento raso |
| G18 | Quatro provas do mesmo aluno: `in-progress`; `scheduledAt` amanhã; `EXAM` entregue e liberada; prova antiga com tentativa por `prisma` e `questionsFrozenAt` nulo | `grantViews(prisma, [ids], aluno)` | Mapa: `answer`, `null`, `review`, `answer`. A prova antiga continua com `questionsFrozenAt` nulo e pin nulo | R19, R9 | `grantViews` divergindo da tabela de `issueExamGrant`; escrita numa leitura em lote |

## Decisões do projetista

- **J1 (R9, R19).** G11, G12, G15 e G18 ficam em `test/exam-grant.spec.ts`
  e leem `questionsFrozenAt`. T3 só é dada como pronta depois do merge de T2.
- **J2 (R6).** `exam.update` com `status: "COMPLETED"` congela, como
  `exam.close`. Coberto por F4 (d).
- **J3 (R15).** O congelamento do grant é profundo: `questions` e cada item
  dela também são congelados. G17 tenta `push` e atribuição em
  `questions`.
- **J4 (R18, R22).** `grantedDocument` com um slug fora do grant lança
  `NotFound("question")`. Coberto por G13.
- **J5 (R17).** Remover a exceção só zera o grant quando ela adiantava a
  prova; uma exceção só de tempo extra, removida, deixa a tentativa
  `submitted`, com `answer`. G5 (b) testa a exceção que adianta.
- **J6 (R19).** `answering` é `false` fora de `in-progress`, inclusive em
  `submitted`, `results` e no faltante.
- **J7 (R19, R22).** Em `PRACTICE`, `{ course, exam }` usa a tentativa mais
  recente dentro de `PRACTICE_SESSION_WINDOW_MS`, como
  `resolveOrCreateAttempt`. Sem tentativa na janela, não há grant. Coberto por
  G12 (b) e (c).
- **J8 (R23).** "Uma consulta" em `grantedQuestions` não tem caso unit; fica
  para o critério de `TEST_PERF_LOG`.
