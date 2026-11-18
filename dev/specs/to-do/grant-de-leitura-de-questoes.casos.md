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

## T4. Service `db.examQuestion`

Arquivo: `test/exam-question-service.spec.ts`. Escopo: `unit`. Todos os casos
falham hoje porque `db.examQuestion` não existe. O `target` é `{ course:
course.id, exam: exam.slug }` e o ator vai em `actorOf(user)`.

Documentos usados abaixo:

- **`mc`**: `capitalChoice` (`src/mdq/fixtures.ts`) com `weight: 2` e
  `tags: ["geo"]`; a escolha certa é `brasilia`, e `rio` vale 0 e não tem
  feedback.
- **`mcV2`**: `mc` com outro `title`, outro `stem`, `weight: 3`, e `rio` como
  escolha certa, com o feedback `"V2 FEEDBACK"`. É o push de `v2` em `mc`.
- **`essay`**: um documento sem `weight`, com `tags`.
- **`code`**: `sumCode`, com `meta.worker` preenchido, como `pushCode` em
  `test/grading-job.spec.ts`. **`codeSemWorker`**: o mesmo, sem `meta.worker`.
  Confira que `pretestSources(sumCode)` não é vazio.

O `weight` de uma versão é o `weight` do documento (`payloadWeight` em
`exam.service.ts` lê `publicPayload.weight`).

| # | Cenário | Ação | Esperado | R | Bug que pega |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Q1 | Prova padrão `EXAM` (`scheduledAt` 10 min atrás, 60 min) com `questions: [{ slug: essay }, { slug: mc, version: "v1" }]`, criadas nessa ordem inversa (`mc` antes de `essay`). Depois de criar a prova, push de `mcV2` em `mc` | Sem tentativa: `forAttempt` e `titles`. Depois `db.response.create` do aluno: `forAttempt` e `titles` | Sem tentativa: `forAttempt` é `null` e `titles` é `{}` (B6). Com tentativa: `{ view: "answer", answering: true }` e `questions` na ordem `[essay, mc]`. `mc` vem com `version: "v1"`, `weight: 2`, `stem` de `v1`; `essay` vem com `weight: 1`. Nenhum item tem a chave `tags` nem a chave `code`, e nada de `score` nas escolhas. `titles` devolve `{ [mc]: título de v1, [essay]: título dele }` | R25, R26, R27, R29 | Ler a última versão em vez do pin; `weight` da prova em vez do da versão; `tags` vazando; grant antes de iniciar |
| Q2 | Prova padrão com `[code, codeSemWorker, mc]`; aluno com tentativa | `forAttempt`; `db.response.finish`; `forAttempt` | Antes de entregar: `code` com `{ sendable: true, pretests: [não vazio] }`, `codeSemWorker` com `sendable: false`, `mc` sem a chave `code`. Depois de entregar: `answering: false`, `code` com `sendable: true` e `pretests: []` | R27 | Pretestes servidos depois da entrega; `code` em questão que não é `code` |
| Q3 | `EXAM` padrão com `[mc (v1), mc2]`, em que `mc2` é outra múltipla escolha. O aluno responde `mc` com `"rio"` e não responde `mc2`; o colega responde `mc2`. Os dois chamam `finish`. Push de `mcV2` em `mc` (a prova já está congelada em `v1`). `outcomes = [{ question: mc, submission: publicId da resposta do aluno, score: 0.25, blanks: null }, { question: mc2, submission: publicId da resposta do colega, score: 1, blanks: null }]` | `reviews(target, outcomes)`; `db.exam.close`; `releaseGrades`; `reviews(target, outcomes)` | Antes da liberação: `{}`. Depois: só a chave `mc`, com `score: 0.25` (a nota vem de quem chama e não é recalculada). Não há chave `mc2`, porque a submissão é de outra tentativa. O JSON da saída não contém `brasilia` nem `V2 FEEDBACK`: o documento é o de `v1` e a chave não vaza | R28 | Revisão antes da liberação; ler resposta de outra tentativa; recalcular nota; corrigir pela versão nova; vazar gabarito |
| Q4 | Faltante: `EXAM` padrão com `[mc, essay]`, aluno sem tentativa, `db.exam.close` | `forAttempt`; `releaseGrades`; `forAttempt`, `reviews(target, outcomes qualquer)` e `titles` | Antes: `null`. Depois: `{ view: "answer", answering: false }` com as duas questões e sem `code`. `reviews` é `{}`. `titles` traz as duas | R39, R28, R29 | Faltante com revisão, ou sem enunciado depois da liberação |
| Q5 | Simulação: prova `DRAFT` com `[mc (v1)]` e push de `mcV2` | O instrutor chama `forAttempt` sem simulação; `db.response.create` (simulação) e `forAttempt`; `db.response.answer` com `"rio"`, `finish`, `reviews` com o `publicId` da submissão da simulação e `score: 0` | `null`; depois `answer` com `answering: true`, `mc` em `v1` com o `stem` de `v1`; por fim, `reviews` com a chave `mc` (simulação libera ao entregar) | R37 | Simulação por outro caminho, que lê a última versão ou o documento privado |

## T5. `studentViews`, anexo de questão e `exam.findOne`/`findMany`

Escopo: `unit`. Sem e2e: a regra aparece inteira nos services, e a rota REST
nova é de T8.

| # | Arquivo | Cenário | Ação | Esperado | R | Falha hoje? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| V1 | `test/exam-before-open.spec.ts` | Um aluno e cinco provas `EXAM` do mesmo curso, cada uma com duas questões: A aberta e sem tentativa; B aberta e com `db.response.create`; C encerrada (`db.exam.close`) e liberada, aluno sem tentativa; D encerrada, sem liberação, aluno sem tentativa; E com `scheduledAt` amanhã. O preâmbulo de A é conhecido | `db.exam.findMany({ course }, aluno)`, `db.exam.findOne` de A e de B pelo aluno, `findMany` pelo instrutor | Para o aluno, `questions` é `[]` em A, D e E, e a lista inteira em B e C. `findOne` concorda com `findMany`. O preâmbulo de A continua visível, porque R33 só esconde `questions`. O instrutor recebe todas as listas | R33 | Sim: hoje A devolve as questões, porque a prova está aberta |
| V2 | `test/exam-attachments.spec.ts` | Use `setup`, `filesFor`, `createQuestion` e `createExam` do arquivo. `q` tem `v1` com `data.csv` (bytes `b1`); a prova está aberta, `q` sem pin, e há um anexo da prova em si. Aluno e colega matriculados | O aluno sem tentativa pede `questionAttachment(q, "data.csv")` e `attachment` da prova. O aluno faz `db.response.create`, o que congela `v1`. Push de `v2` em `q`, com `data.csv` de bytes `b2`. Pedem `questionAttachment`: o aluno, o colega sem tentativa e o instrutor sem tentativa | Sem tentativa: `questionAttachment` dá 404, e o anexo da prova baixa. Com tentativa: `b1`. Colega: 404. Instrutor: `b1`, a versão fixada, como hoje | R35, R36 | Sim: hoje o aluno sem tentativa baixa o anexo da questão com a prova aberta |
| V3 | `test/grading-job.spec.ts` | `world({ examType: "QUIZ", meta: { attempts: 1 } })`, com a prova criada com `scheduledAt` 10 min atrás e 60 min de duração. Um colega com exceção `scheduledAt` 1 h no futuro. `sentBy(w, "DONE", GRADED)`. `db.exam.close` | (a) `forStudent(lookup(w), asStudent(w))`. (b) `prisma.examException.update` move o `scheduledAt` do colega para 3 h atrás, e o aluno chama de novo. (c) `prisma.exam.update` com `status: "ARCHIVED"`, e o aluno chama de novo | (a) `report` sem `score`: a segunda chamada pendente do colega segura a liberação. (b) `report` com `score`. (c) A submissão continua listada, mas sem `report` | R21, R34 | (a) Provavelmente sim: `examReleaseSelect(actor)` só carrega a matrícula do aluno, e a exceção do colega conta como de desmatriculado. Se passar, fica como regressão. (c) Sim: hoje o relatório sai com a prova arquivada |
| V4 | `test/grading-job.spec.ts` | Instrutor com simulação (`db.response.create` do instrutor) numa `EXAM` com `meta: { attempts: 1 }`, sem liberação. Submissão `SUBMIT` da simulação com job `DONE` e `runnerReport: GRADED`, montada como em `enqueue`/`sentBy`, mas sobre a resposta da simulação | `forStudent({ response: simulação.publicId, question }, actorOf(instructor))` | `report` com `score`: a simulação libera como prática | R34, R37 | Não: regressão. O grant de simulação precisa manter o que o modo `PRACTICE` faz hoje |

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
- **J9 (R3, R11).** `freezeQuestionVersions` grava `questionsFrozenAt` sem
  mover `Exam.updatedAt` (`writeCache`): o congelamento é efeito da primeira
  tentativa, e não pode dar 412 no próximo push condicional de quem leu a
  prova antes. O pin que o push ignora (R11) já protege a prova.
- **J10 (R11).** `exam.update` reescreve as linhas com `deleteMany` e
  `create`, com a versão já reconciliada (pin mantido, questão nova na última
  versão), em vez de um diff linha a linha. O resultado é o mesmo.
- **J11 (R6).** `exam.create` com `status: "COMPLETED"` não congela; o
  congelamento preguiçoso do grant (R9) cobre esse caso.
- **J12 (R28).** Em `reviews`, um `outcome` cuja `submission` não é da
  tentativa do grant, ou cujo slug não está no grant, fica fora do resultado
  em silêncio, sem erro. Coberto por Q3.
- **J13 (R34).** "Sem grant, o relatório não sai": `forStudent` continua
  listando as submissões e o estado do job, mas sem `report`. Não é
  `NotFound`. Coberto por V3 (c).
- **J14 (R33).** Sem grant, `exam.findOne` e `findMany` escondem só
  `questions`; o preâmbulo e os anexos da prova seguem a fase pessoal, como
  hoje (R36). Coberto por V1 e V2.
