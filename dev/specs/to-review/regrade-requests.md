---
type: spec
status: implemented
tags: [grading, exams, students, instructor]
relatedTo: [web-grading, feedback-service, exam-result, per-student-exceptions]
---

# Pedido de revisão de nota

## Contexto

Depois que as notas saem, o aluno que discorda da correção de uma questão
manda e-mail ou fala no fim da aula. O professor perde o pedido, ou corrige
e esquece de responder. Este spec leva o pedido para dentro do Codehood: o
aluno contesta uma questão com uma justificativa, o professor vê uma fila,
revisa (escrevendo um passe de correção novo) ou recusa com uma resposta, e o
aluno vê o resultado.

A revisão em si já existe: um passe de correção novo vira a nota da questão
(`feedback.service.ts`, `actions.grading.grade`). O que falta é o pedido, a
fila e a resposta.

## Glossário

- **Pedido de revisão**: contestação de um aluno à nota de uma questão de uma
  tentativa, com justificativa, que o professor aceita (com nota nova) ou
  recusa (com resposta). Entra no `GLOSSARY.md`.

## Requisitos

### Banco

**R1.** Novo modelo:

```prisma
enum RegradeStatus {
  OPEN
  ACCEPTED
  REJECTED
}

/// A student's request to review the grade of one answer, and the
/// instructor's answer to it.
model RegradeRequest {
  id       Int    @id @default(autoincrement())
  publicId String @unique

  /// The counting answer being contested. At most one request per answer.
  submissionId Int        @unique
  submission   Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)

  /// The student's justification.
  message String

  status RegradeStatus @default(OPEN)

  /// The instructor's answer. Required to resolve the request.
  reply String?

  /// The grading pass written when the request was accepted.
  feedbackId Int?      @unique
  feedback   Feedback? @relation(fields: [feedbackId], references: [id], onDelete: SetNull)

  resolvedById String?
  resolvedBy   User?     @relation(fields: [resolvedById], references: [username])
  resolvedAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

O autor não é guardado: sai de `submission.response.author`. O curso e a prova
também.

### Regras

**R2.** Um aluno abre um pedido para uma questão quando todas valem:

- é o autor da tentativa;
- o resultado da tentativa está visível para ele (`attemptState` com timing
  pessoal, ver [exceções por aluno](per-student-exceptions.md), em
  `results`);
- a prova é `QUIZ` ou `EXAM` (prática não tem nota a contestar);
- a submissão é a resposta que conta naquela questão e o estado dela é
  `graded` ou `not-graded` (não `pending`, não `unanswered`);
- não existe pedido para essa submissão (aberto ou resolvido: um pedido por
  resposta, e a resposta do professor é final);
- não passaram mais de `REGRADE_WINDOW_DAYS = 14` dias do momento da
  liberação (`releaseMoment`). Quando o momento é desconhecido (`null`), não
  há limite.

Violar qualquer uma dá um erro de domínio com mensagem localizada.

**R3.** A justificativa tem de 10 a 2000 caracteres, depois de `trim`.

**R4.** O aluno pode retirar o próprio pedido enquanto ele está `OPEN`. Retirar
apaga a linha, e ele pode abrir outro (o limite de R2 é por pedido existente).

**R5.** O professor resolve um pedido `OPEN`:

- **Aceitar**: informa a nota nova (0–100, como na correção) e a resposta.
  No mesmo `$transaction`, escreve um passe de correção com
  `ref: regrade-<publicId>`, `graderId` do professor e a resposta como
  comentário, e marca o pedido `ACCEPTED` com `feedbackId`. A nota nova pode
  ser igual à antiga (o professor aceitou rever e manteve).
- **Recusar**: só a resposta (obrigatória, 1–2000 caracteres). Marca
  `REJECTED`.
- Um pedido resolvido não muda mais. Resolver duas vezes dá erro.

**R6.** Um passe de correção escrito pela tela de correção comum, com um pedido
aberto, não resolve o pedido: o professor resolve explicitamente. A tela de
correção mostra o pedido aberto junto da resposta (R11).

### Service e permissões

**R7.** `RegradeRequestService` em `src/db/services/regrade-request.service.ts`,
seguindo `src/db/services/README.md`. Chave natural: `publicId`. Métodos:
`create` (aluno), `findOne`, `findMany` (filtros `course`, `exam`, `status`,
`author`), `delete` (retirar), mais `accept` e `reject`. `update` e `upsert`
ficam como stubs `never`.

**R8.** Permissões novas no registro:

- `regrade.request`: o autor da tentativa (as condições de R2 ficam no service,
  não na permissão).
- `regrade.resolve`: o dono do curso. Admin que não é dono não resolve
  (corrigir é do professor do curso, como em `web-grading`).
- Leitura: o autor lê os próprios pedidos; o dono do curso lê os do curso;
  ninguém mais.

**R9.** Sem REST nesta versão. A CLI não tem comandos de correção, e um bot
que quiser revisar já escreve passes pela REST de feedback.

### Telas

**R10.** Aluno, na página da prova com resultado (`ExamAttempt.tsx`,
componente `Outcome`):

- Botão "Pedir revisão" por questão quando R2 permite, que abre um diálogo com
  a justificativa. `QuestionOutcome` (`exam-result.ts`) ganha o `publicId` da
  submissão que conta, para o botão saber o que contestar.
- Com pedido aberto: badge "Revisão pedida", a justificativa e o botão
  "Retirar".
- Resolvido: badge "Revisão aceita" ou "Revisão recusada" e a resposta do
  professor. Aceito, a nota mostrada já é a nova (sai do passe novo).
- Fora do prazo ou sem condição: nada (sem botão desabilitado misterioso).
  Fora do prazo com pedido existente mostra o pedido normalmente.

**R11.** Professor:

- Nova página `exams/[slug]/regrades.astro`: os pedidos da prova, abertos
  primeiro (mais antigos no topo), depois os resolvidos. Cada cartão mostra o
  aluno, a questão, a resposta do aluno (componente `Answer` da correção),
  a nota atual e o histórico de passes, a justificativa e o formulário
  aceitar/recusar.
- A página da prova ganha um aviso "N pedidos de revisão abertos", com link,
  como o aviso de respostas pendentes.
- `grading/[question].astro` e `attempts/[username].astro` mostram o badge
  "Revisão pedida" com link para o cartão em `regrades`.
- A página inicial do professor (`instructor-home.ts`) ganha a lista
  `regrades`: provas com pedidos abertos e a contagem, ao lado de `toGrade`.

**R12.** A página inicial do aluno (`student-home.ts`) mostra os pedidos dele
resolvidos nos últimos 7 dias, ao lado de `results`.

**R13.** Textos em `messages/{en,pt-BR}/`. Ações em `src/actions/regrade.ts`
(`request`, `withdraw`, `accept`, `reject`), finas sobre o service.

### Dados de dev

**R14.** `src/db/bootstrap.ts` semeia, nas provas com notas liberadas de
`cs101`:

- um pedido aberto do aluno de dev (o aluno vê "Revisão pedida" e o
  professor vê a fila);
- um pedido aceito com nota nova e um recusado, de outros alunos;
- uma questão em que o aluno de dev ainda pode pedir revisão (botão visível).

## Fora do escopo

- Aviso por e-mail ao professor e ao aluno: `dev/issues/resumo-semanal-por-email.md`.
- Prazo de revisão configurável por prova.
- Conversa em várias mensagens: o pedido tem uma justificativa e uma
  resposta.
- REST e CLI.

## Plano de ação

TDD em modo full.

**T1. Banco, schemas, permissões.** `prisma/schema.prisma`,
`src/db/branding.ts`, `src/core/schemas/regrade-request.ts`,
`src/auth/permissions/index.ts`, `src/fixtures/regrade-request.factory.ts`.
Cobre R1, R8. Pronto quando `pnpm run typecheck` sai 0 e o seed antigo
continua rodando.

**T2. Service.** `src/db/services/regrade-request.service.ts`. Cobre R2–R7.
Depende de T1. Pronto quando `test/regrade-request-service.spec.ts` passa:
cada condição de R2 recusada, prazo, retirar e abrir de novo, aceitar
escreve o passe e muda a nota em `examResult`, recusar sem resposta dá erro,
resolver duas vezes dá erro, outro aluno não lê.

**T3. Resultados e páginas iniciais.** `src/services/exam-result.ts`
(`publicId`), `instructor-home.ts`, `student-home.ts` e os loaders. Cobre R10
(parte de dados), R11 (home), R12. Depende de T2.

**T4. Histórias e telas.** Histórias em `docs/user-stories/student.md` e
`instructor.md`, e2e em `test/stories/student-exams.test.ts` e
`test/stories/instructor-grading.test.ts`:

- Aluno: tenta pedir com justificativa curta (erro), pede, retira, pede de
  novo, vê o pedido recusado com a resposta.
- Professor: vê o aviso na página da prova, tenta recusar sem resposta
  (erro), aceita com nota nova e vê a nota do aluno mudar.

Depois as telas (R10, R11, R13) e o seed (R14). Depende de T3. Pronto quando
os e2e passam.

**T5. Fechamento.** `GLOSSARY.md`, `CHANGELOG.md`, `pnpm exec biome check
--write .`, `pnpm run lint`, suíte inteira.

## Critérios de aceite

- Screenshots: diálogo do aluno, fila do professor com um pedido aberto e um
  resolvido, aviso na página da prova.
- Saída verde dos testes de service e dos e2e.
