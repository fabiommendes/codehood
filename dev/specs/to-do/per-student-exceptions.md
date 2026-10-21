---
type: spec
status: todo
tags: [exams, deadlines, instructor, accommodations]
relatedTo: [exam-state, response-service, submission-service, web-grading, calendar-feed]
---

# Exceções por aluno em provas

## Contexto

Todo semestre o professor precisa tratar um aluno de forma diferente numa
prova: tempo extra para quem tem atendimento especial, segunda chamada para
quem faltou com atestado, reabrir a tentativa de quem caiu a conexão. Hoje a
única ferramenta é `Exam.extraTime`, que vale para a turma inteira, e reabrir
uma resposta só é possível pela REST API e só antes do prazo.

Este spec cria a **exceção de prova**: um ajuste de horário de um aluno numa
prova. Toda regra de "pode responder agora?" e "qual é o prazo?" passa a olhar
a exceção do aluno, sem que cada chamador precise lembrar disso.

## Glossário

- **Exceção de prova**: ajuste de um aluno numa prova, com tempo extra, uma
  nova data de início (segunda chamada) ou as duas coisas. Entra no
  `GLOSSARY.md`.
- **Janela pessoal**: a janela de resposta da prova para um aluno, já com a
  exceção dele aplicada. Sem exceção, é a janela da prova.

## Requisitos

### Banco

**R1.** Novo modelo:

```prisma
/// One student's adjustment to an exam's timing: extra time, a makeup start,
/// or both. At most one per student and exam.
model ExamException {
  id Int @id @default(autoincrement())

  examId Int
  exam   Exam @relation(fields: [examId], references: [id], onDelete: Cascade)

  username String
  user     User   @relation(fields: [username], references: [username], onDelete: Cascade)

  /// Added to the exam's duration + extraTime for this student only.
  extraTimeMs Int @default(0)

  /// Replaces the exam's scheduledAt for this student (makeup exam). Null
  /// keeps the exam's own date.
  scheduledAt DateTime?

  /// Free text for the instructor, e.g. "atestado". Never shown to students.
  note String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([examId, username])
  @@index([username])
}
```

`Exam` e `User` ganham a relação inversa `exceptions ExamException[]`.

### Regras de horário

Todas em `src/services/exam-state.ts`, puras.

**R2.** Nova função `personalTiming(exam, exception): ExamTiming` que devolve o
horário que vale para o aluno:

- `extraTime` = `exam.extraTime + exception.extraTime`.
- Com `exception.scheduledAt`: `scheduledAt` passa a ser o da exceção e o
  status efetivo passa a `SCHEDULED`, a menos que a prova seja `DRAFT` ou
  `ARCHIVED`, que continuam como estão. Isso vale mesmo que o professor já
  tenha encerrado a prova (`COMPLETED`): a segunda chamada reabre a prova só
  para aquele aluno.
- Sem exceção (`null`), devolve a prova sem mudança.
- `PRACTICE` ignora a exceção (prática não tem prazo).

**R3.** `attemptState`, `attemptDeadline` e `examPhase`, quando falam de um
aluno, recebem o resultado de `personalTiming`. A assinatura deles não muda;
o que muda é que todo chamador que avalia um aluno específico passa a timing
pessoal. `examPhase` sobre a prova inteira (listas do professor, badges)
continua com a timing da prova.

**R4.** Nova função `lastWindowEnd(exam, exceptions): Date | null`: o fim mais
tardio entre a janela da prova e as janelas pessoais. `null` se alguma delas
não tem fim.

**R5.** Liberação de notas com exceções pendentes:

- `gradeReleaseBlocker` ganha o bloqueio `"exception-open"`: um `EXAM` não pode
  ter as notas liberadas enquanto a janela pessoal de algum aluno com exceção
  estiver `upcoming` ou `open`. Sem isso, a turma recebe o gabarito antes da
  segunda chamada.
- `resultsReleased` de um `QUIZ` passa a exigir também que todas as janelas
  pessoais tenham fechado (`lastWindowEnd`), pelo mesmo motivo. As duas
  funções recebem a lista de exceções da prova como parâmetro novo
  (opcional, com padrão `[]`).
- `releaseMoment` de um `QUIZ` usa `lastWindowEnd` em vez de `windowEnd`.

**R6.** Restrições de uma exceção, validadas no service:

- `extraTimeMs >= 0`, no máximo 24 h.
- `scheduledAt` só é aceito numa prova com duração. Numa prova sem duração, a
  janela pessoal nunca fecharia.
- Exceção só em prova `QUIZ` ou `EXAM`, nunca `PRACTICE`.
- O aluno precisa estar matriculado no curso (ativo ou trancado; uma exceção
  de quem trancou não incomoda ninguém).
- Uma exceção sem efeito (`extraTimeMs = 0` e `scheduledAt` nulo) é recusada.
  Para tirar a exceção, apaga-se a linha.

### Onde a regra é aplicada

**R7.** O servidor aplica a janela pessoal ao aceitar respostas:
`assertAcceptingSubmissions` e `assertExamOpen` (`submission.service.ts`,
`response.service.ts`) carregam a exceção do autor e usam `personalTiming`. É o
que impede um aluno de responder fora da janela, não a tela.

**R8.** Todos os pontos que hoje calculam o estado de um aluno usam a timing
pessoal:

- `src/services/student-home.ts`, `src/services/course-home.ts`,
  `src/services/calendar-entries.ts` (que hoje repete a soma de
  `duration + extraTime`: passa a chamar `windowEnd`/`personalTiming`).
- `src/services/grading.ts` e `src/services/grades-table.ts`: uma tentativa
  só conta como fechada (e só entra na fila de correção) quando a janela
  pessoal do autor fechou.
- `src/services/instructor-home.ts`: "em andamento" considera as janelas
  pessoais (`lastWindowEnd`), para a prova não aparecer como "a liberar"
  antes da segunda chamada.
- `src/components/exam/ExamRow.astro`, `exams/index.astro`, `exams/[slug].astro`
  e `exams/[slug]/attempts/[username].astro`.

Os loaders carregam as exceções numa consulta por prova (ou por curso), nunca
uma por aluno.

### Service e permissões

**R9.** `ExamExceptionService` em `src/db/services/exam-exception.service.ts`,
seguindo `src/db/services/README.md`. Chave natural: `(course, exam, username)`.
Métodos: `create`, `findOne`, `findMany` (filtros `course`, `exam`,
`username`), `update`, `upsert`, `delete`.

**R10.** Permissão nova `exam.manage-exceptions` no registro
(`src/auth/permissions/index.ts`): dono do curso e admin, como
`roll-call.manage`. Leitura:

- O dono do curso lê todas as exceções do curso.
- O aluno lê a própria exceção, sem o campo `note` (o schema de saída do
  aluno não tem `note`).
- Os outros alunos não veem nem a existência dela.

**R11.** Reabrir uma tentativa: nova ação `exam.reopenAttempt` (Astro Action,
fina sobre `ResponseService.update`), só para o dono do curso. Põe
`acceptingSubmissions = true`. É recusada (erro de domínio, mensagem
localizada) quando a janela pessoal do aluno já fechou: o professor precisa
antes conceder tempo extra ou uma nova data. As respostas já dadas continuam
lá; o aluno continua de onde parou.

**R12.** REST: `CRUD` em
`/api/course/[discipline]/[course]/exam/[slug]/exception/[username]`, com
exemplos em `test/bruno/exam-exception/`. Serve para o professor lançar as
exceções de uma lista de alunos por script. Sem comando novo na CLI nesta
versão.

### Telas

**R13.** Página da prova (`exams/[slug].astro`), visão do professor: seção
"Exceções" abaixo dos resultados, só para `QUIZ` e `EXAM`:

- Tabela: aluno, tempo extra, nova data, janela pessoal resultante
  (início–fim), nota, ações (editar, remover).
- Botão "Adicionar exceção" que abre um diálogo com: aluno (select com os
  matriculados), tempo extra em minutos, nova data e hora (opcional), nota.
  Formulário segundo `dev/adrs/` sobre forms (`src/forms/`).
- Remover pede confirmação no próprio diálogo (sem `confirm()` do navegador).

**R14.** Página da tentativa (`attempts/[username].astro`): mostra a exceção do
aluno, se houver, com link para editá-la, e o botão "Reabrir tentativa" quando
a tentativa está fechada e a janela pessoal ainda não fechou.

**R15.** Visão do aluno:

- `exams/[slug].astro`, a lista de provas e a página inicial mostram a data e o
  prazo pessoais. A contagem regressiva em `ExamAttempt.tsx` usa o prazo
  pessoal (que já chega pronto em `state.deadline`).
- Com exceção, a linha de duração diz "Duração: 90 min + 30 min para você" (ou
  "Nova data: …" na segunda chamada). Textos em `messages/{en,pt-BR}/`.

### Dados de dev

**R16.** `src/db/bootstrap.ts` semeia, em `cs101`:

- Uma prova agendada e com duração, ainda por começar, em que o aluno de dev
  tem 30 min extras (o aluno vê o "+30 min para você").
- Uma prova encerrada em que um aluno que faltou tem segunda chamada marcada
  para daqui a dois dias (o professor vê o bloqueio "exception-open" ao tentar
  liberar as notas).
- Uma prova encerrada em que um aluno tem exceção com tempo extra, a tentativa
  dele está fechada e a janela pessoal ainda está aberta (o botão "Reabrir
  tentativa" aparece).

## Fora do escopo

- Tentativa extra como uma `Response` nova (exige mudar `slotKey`). Reabrir a
  tentativa existente cobre o caso da conexão que caiu.
- Exceções em lote pela web (o REST cobre por script).
- Comando na CLI.
- Política de atraso com desconto: `dev/issues/politica-de-atraso.md`.

## Plano de ação

TDD em modo full: o orquestrador desenha os stubs, o `tester` escreve os
testes por lote, o `implementer` faz passar sem ler os testes.

**T1. Regras puras.** `src/services/exam-state.ts`. Cobre R2–R5. Sem
dependências. Pronto quando `test/exam-state.spec.ts` (casos novos) passa:
tempo extra somado, segunda chamada numa prova `COMPLETED`, prova sem
duração, prática ignorada, bloqueio `exception-open`, quiz que só libera
depois da última janela pessoal.

**T2. Banco, schemas, service, permissões.** `prisma/schema.prisma`,
`src/db/branding.ts`, `src/core/schemas/exam-exception.ts`,
`src/db/services/exam-exception.service.ts`, `src/auth/permissions/index.ts`,
`src/fixtures/exam-exception.factory.ts`. Cobre R1, R6, R9, R10. Paralelo a
T1. Pronto quando `test/exam-exception-service.spec.ts` passa e `pnpm run
typecheck` sai 0.

**T3. Aplicação no servidor.** `submission.service.ts`, `response.service.ts`,
`src/actions/exam.ts`. Cobre R7, R11. Depende de T1 e T2. Pronto quando os
testes de service mostram: aluno com tempo extra responde depois do prazo
geral e antes do pessoal; aluno da segunda chamada responde depois do
encerramento; outro aluno não; reabrir com janela fechada é recusado.

**T4. Chamadores.** Os arquivos de R8. Depende de T1 e T2. Pronto quando os
testes de `grading`, `grades-table`, `student-home` e `instructor-home` com
exceção passam.

**T5. REST.** `src/api/index.ts`, `test/bruno/exam-exception/`. Cobre R12.
Depende de T2. Pronto quando `test/api-exam-exception.spec.ts` passa e
`test/api-no-raw-ids.spec.ts` continua verde.

**T6. Histórias e telas.** Histórias em `docs/user-stories/instructor.md` e
`student.md`, e2e em `test/stories/instructor-questions-and-exams.test.ts` e
`test/stories/student-exams.test.ts`:

- Professor: tenta criar exceção vazia (erro), cria tempo extra, cria segunda
  chamada, tenta liberar notas (bloqueado), reabre uma tentativa.
- Aluno: vê o prazo pessoal e responde depois do prazo geral.

Depois as telas (R13–R15) e o seed (R16). Depende de T3–T5. Pronto quando os
e2e passam.

**T7. Fechamento.** `GLOSSARY.md`, `CHANGELOG.md`, `pnpm exec biome check
--write .`, `pnpm run lint`, suíte inteira.

## Critérios de aceite

- Screenshots: seção "Exceções" do professor, diálogo de nova exceção, página
  do aluno com "+30 min para você", bloqueio de liberação de notas.
- Saída verde de `test/exam-state.spec.ts`, dos testes de service e dos e2e.
- Prova por teste de que a resposta fora da janela pessoal é recusada pelo
  servidor, não só escondida na tela.
