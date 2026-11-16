---
type: spec
status: to-do
tags: [exam, instructor, ui, grading, schema]
relatedTo: [pesos-e-numeros-de-questao, card-de-navegacao-do-curso, pagina-da-prova-do-professor-precisa-ser-retrabalhada]
---

# Simulação e prévia da prova do professor

## Problema

Três pedidos do professor sobre as páginas da prova, depois da divisão do
commit `636e9fc`:

1. A página `questions` deveria se chamar "preview" e mostrar a visão do
   estudante de verdade. Hoje ela monta `ExamPreview`, que reusa
   `QuestionFrame` e `AnswerField` mas não tem estado de tentativa, barra,
   cronômetro, autosave, rascunho, histórico de edição, envio ao worker nem
   revisão. O que o professor confere ali não garante o que o aluno recebe.
2. A visão geral deveria listar as questões com os pesos e, quando a prova já
   recebeu respostas, a média e a discriminação de cada uma.
3. O professor deveria poder responder a própria prova como aluno. A resposta
   dele é sempre imediata e não entra em nota, estatística nem fila.

Estado do código que a spec parte:

- O professor não abre tentativa: `prepareAttempt` exige matrícula ativa do
  autor (`src/db/services/response.service.ts`), e a página dele não carrega
  tentativa.
- Pesos não existem no servidor (spec `pesos-e-numeros-de-questao.md`, em
  to-do).
- `questionStats` (`src/services/question-stats.ts`) já calcula média e
  discriminação, e `loadExamStaffData` já as devolve em `statsRows`.
- O servidor não corrige questão objetiva: `scoreResponse` só roda para
  exibir (`src/services/review.ts`). As respostas ficam `PENDING_GRADE`
  (issue `pagina-da-prova-do-professor-precisa-ser-retrabalhada`, item 2).
- Nada impede matricular o instrutor no próprio curso.

## Decisões

- D1. A simulação é uma `Response` marcada com `preview = true`. Não há tabela
  separada, tentativa em memória nem filtro pelo papel do autor. O flag fica
  só em `Response`: submissões, jobs, feedback e pedidos de revisão chegam a
  ele por `submission.response`.
- D2. `slotKey` não marca a simulação. `practice: true` é `slotKey != 0`, e um
  valor reservado seria lido como sessão de prática.
- D3. A página de prévia e a simulação são a mesma coisa: a rota `preview`
  monta `ExamAttempt` sobre a simulação do professor. `ExamPreview` é
  removido.
- D4. O resultado aparece ao entregar: a tela vai direto para `results`, como
  a do aluno depois da liberação. Não há resultado por questão durante a
  resposta.
- D5. A simulação ignora o status e a data da prova (vale para `DRAFT`). O
  cronômetro roda com a duração da prova, sem exceções.
- D6. Uma simulação por professor e prova. "Recomeçar" apaga e recria.
- D7. Questões de correção manual mostram "correção manual" com gabarito e
  rubrica, e nunca entram na fila de correção.
- D8. Envios de código da simulação vão para a fila normal do worker, com as
  regras de prática: envios ilimitados, sem desconto, nota visível.
- D9. O histórico de edição na simulação segue `effectiveAnswerHistory(exam)`,
  como na tentativa do aluno.
- D10. `/questions` vira `/preview`, sem redirect. O rótulo do card é uma
  mensagem nova de i18n ("Preview" / "Prévia").
- D11. O instrutor de um curso não pode ser aluno matriculado nele. Por isso
  o índice único `[authorId, examId, slotKey]` de `Response` não muda.
- D12. A visão geral ganha uma tabela enxuta de questões.
  `results#by-question` continua com a tabela completa.
- D13. Os pesos entram antes, pelas tarefas T1 e T2 de
  `pesos-e-numeros-de-questao.md`.
- D14. O servidor passa a corrigir as questões objetivas ao fechar a
  tentativa, para toda tentativa, não só a simulação.
- D15. A simulação vale também em prova `PRACTICE`.

### Decisão em aberto

- DA1. A correção automática de D14 vale para respostas já `PENDING_GRADE` em
  produção?
  - (a) Recomendada: não corrigir na migração. Um comando de gestão
    (`pnpm run manage grade-objectives --course <c> [--exam <e>] [--dry-run]`)
    corrige as pendentes de provas ainda não liberadas, e o professor o roda
    por prova. Provas com `gradesReleasedAt` ficam fora, salvo `--released`.
    Motivo: a nota passa a existir sem ação do professor, e em prova já
    liberada o aluno veria a nota mudar sem aviso.
  - (b) Corrigir tudo na release, por script de dados. Simples, mas muda
    notas de provas liberadas e não tem volta fácil.
  - (c) Só respostas novas. Deixa as cerca de 130 respostas por questão da
    `lista1-elm` pendentes para sempre.

  Até a decisão, T3 implementa só o caminho de fechamento e o comando com
  `--dry-run`; a regra de provas liberadas segue (a).

## Regras

### Matrícula do instrutor

- R1. Matricular o instrutor do curso é recusado com `InvalidData` em
  `username`, em todos os caminhos que gravam `Enrollment`:
  `enrollment.service.create` (usado pela redenção de convite em
  `src/actions/auth.ts` e por `src/actions/course.ts`), a entrada por
  passphrase (`passphrase.service.ts`) e o check-in que age como convite
  (`roll-call.service.ts`). A guarda é uma função só, em `src/db/`, chamada
  pelos três.
- R2. `pnpm run manage check-instructor-enrollments` lista as matrículas em
  que `username` é o instrutor do curso, com contagem de tentativas, e sai
  com código 1 quando há alguma. Com `--fix`, remove as que não têm
  tentativa. As que têm ficam para decisão manual.
- R3. `course.service.update`, ao trocar o instrutor para alguém matriculado
  no curso, é recusado com a mesma mensagem.

### Correção automática de objetivas

- R4. Ao fechar uma tentativa (`finish`, `update`/`upsert` com
  `acceptingSubmissions: false`, e o fechamento por tempo), o servidor
  corrige a submissão que conta de cada questão cujo tipo `scoreResponse`
  aceita: grava um `Feedback` sem `graderId` com a nota e marca a submissão
  `GRADED_AUTOMATICALLY`. Questões `code`, e as que lançam `NotAutoGradable`,
  ficam como estão.
- R5. Uma resposta que a biblioteca recusa (`ResponseError`) recebe 0.
- R6. A correção usa a versão da questão que a prova fixa, a mesma de
  `reviewResult`.
- R7. Uma submissão que já tem `Feedback` não é corrigida de novo. Reabrir e
  fechar a tentativa corrige só a submissão nova que passou a contar.
- R8. Uma nota manual posterior continua valendo sobre a automática
  (`newestPassesFirst`).
- R9. A regra de liberação não muda: o aluno só lê o feedback quando a prova
  o libera.

### Simulação

- R10. `Response.preview Boolean @default(false)`. Só o service o grava, e
  ele não muda depois da criação. Não existe nos corpos de create/update da
  REST.
- R11. Só quem tem `course.update-contents` abre uma simulação, e só como
  autor de si mesmo. A matrícula não é exigida para ela. Uma tentativa comum
  continua exigindo matrícula.
- R12. A simulação ignora `hiddenFromStudents`, `assertExamOpen` e a janela
  da prova. O prazo dela é `createdAt + durationMs + extraTimeMs` quando a
  prova tem duração, e nenhum quando não tem. Exceções não se aplicam.
- R13. `slotKey` da simulação é 0 em qualquer tipo de prova. Em `PRACTICE`,
  a janela de reuso de sessão não se aplica.
- R14. `response.restartPreview` apaga a simulação do ator na prova (com
  submissões, jobs e feedback, pelo cascade que `delete` já usa) e cria outra.
  A semente do embaralhamento muda junto, por ser o `publicId`.
- R15. Para a fila de código, a simulação conta como prática: sem limite de
  envios, sem desconto, e `gradeVisible` verdadeiro. O worker a recebe pelo
  `claim` como qualquer job.
- R16. Ao entregar, a simulação fica em `results` na hora: `attemptOf` recebe
  `released: true` para ela. A correção de R4 roda no mesmo fechamento.
- R17. Na revisão da simulação, uma questão sem nota e não corrigível
  automaticamente mostra "correção manual" e o gabarito. Não há pedido de
  revisão.
- R18. O histórico de edição segue a configuração da prova (D9).

### Isolamento

- R19. `responseFilter` ganha `preview: boolean`, com padrão `false` em
  `response.findMany`. `findOne` por `publicId` devolve a simulação a quem
  pode lê-la.
- R20. As leituras que partem de `Submission`, `Feedback`, `GradingJob`,
  `RegradeRequest` e do histórico de edição excluem
  `response.preview = true`, por um fragmento `where` único exportado de
  `src/db/`. Exceções: o `claim`/`renew`/`report` do worker, a leitura dos
  envios pelo próprio autor (`gradingJob.forStudent`), o feedback lido pelo
  autor da simulação, e as leituras por id da própria simulação.
- R21. Nenhuma saída destas muda com a existência de uma simulação:
  `loadExamStaffData` (resultados, estatísticas, pendências, bloqueio de
  liberação), `exam.releaseGrades`, `loadGrading` e a fila de correção,
  `courseGrades` e o CSV, as homes de instrutor e aluno, a lista de provas,
  pedidos de revisão, contagens de uso de rubrica, `answer-history-stats`,
  `gradingJob.forInstructor`, `promoteExpiredSends`, e as listagens REST de
  respostas, submissões e feedback.
- R22. `feedback.create` manual numa submissão de simulação é recusado.

### Telas

- R23. `exams/[slug]/preview` substitui `exams/[slug]/questions`. Monta
  `ExamAttempt` com a simulação do professor: tela de início quando não há
  simulação, a tentativa em andamento, ou a revisão. Uma faixa fixa diz que
  é uma simulação e que não conta nota, com o botão "Recomeçar".
- R24. Quando há envio na fila e nenhum worker o pegou, a tela diz que o
  envio espera um worker (o estado que `CodeSends` já mostra).
- R25. A visão geral ganha a tabela de questões: `Qn`, título com link para a
  questão no curso (onde está o gabarito), tipo, peso, média e discriminação.
  Peso só aparece quando alguma questão tem peso diferente de 1. Média e
  discriminação só aparecem quando há tentativa fechada; a discriminação
  ausente mostra o motivo, como em `QuestionStats`.
- R26. O card (`examNav`) troca a entrada "Questões" por "Prévia", com `href`
  `…/preview`. A visão geral do aluno não muda.

## Mudanças por arquivo

- `prisma/schema.prisma`: `Response.preview`. Sem migração à mão.
- `src/core/schemas/response.ts`: `preview` na saída e no filtro.
- `src/db/services/response.service.ts`: R10 a R14, R19; chama a correção de
  R4 nos fechamentos.
- `src/db/services/submission.service.ts`: prazo e janela da simulação
  (`assertAcceptingSubmissions`), R20.
- `src/db/services/objective-grading.ts` (novo): R4 a R8, sobre `tx`.
- `src/services/exam-state.ts`: prazo e estado da simulação (R12, R16).
- `src/services/code-grading.ts`, `src/db/services/grading-job-queue.ts`,
  `src/db/services/grading-job.service.ts`: R15, R20.
- `src/db/services/feedback.service.ts`, `regrade-request.service.ts`,
  `rubric-store.ts`, `answer-edit.service.ts`, `exam.service.ts`
  (`attemptResults`): R20, R22.
- `src/db/services/enrollment.service.ts`, `passphrase.service.ts`,
  `roll-call.service.ts`, `course.service.ts`: R1, R3.
- `src/commands/check-instructor-enrollments.ts`,
  `src/commands/grade-objectives.ts` (novos): R2, DA1.
- `src/actions/exam.ts`: `startPreview`, `restartPreview`; as actions de
  responder e entregar aceitam a simulação.
- `src/pages/[discipline]/[course]/exams/[slug]/preview.astro` (novo, no
  lugar de `questions.astro`), `exams/[slug].astro` (tabela),
  `src/utils/exam-nav.ts`, `src/utils/load-exam-staff.ts`.
- `src/components/exam/ExamAttempt.tsx`: faixa e botão da simulação, revisão
  sem pedido de revisão. `src/components/exam/ExamPreview.tsx`: removido.
- `src/components/exam/ExamQuestionsTable.astro` (novo): R25.
- `src/db/bootstrap.ts`: uma prova com simulação em andamento, uma com
  simulação entregue (objetiva corrigida, dissertativa em "correção manual",
  envio de código corrigido), e a prova com pesos da spec de pesos.
- `cli/`: `pnpm run openapi:cli` (o filtro e o campo `preview` mudam a REST).

## Testes

- Unit, matrícula: cada um dos três caminhos recusa o instrutor; o comando
  lista e, com `--fix`, remove só as matrículas sem tentativa.
- Unit, correção de objetivas: cada tipo objetivo, resposta inválida, questão
  manual intocada, idempotência, nota manual por cima, reabrir e fechar.
- Unit, simulação: abre sem matrícula e em `DRAFT`; aluno e instrutor de
  outro curso são recusados; prazo pela duração; recomeçar apaga tudo;
  envios ilimitados; `results` ao entregar.
- Unit, diferencial de isolamento (`test/preview-isolation.spec.ts`): uma
  fixture cria a prova com tentativas de alunos e mede cada saída de R21;
  cria uma simulação entregue com dissertativa pendente, envio de código
  corrigido pelo worker e histórico de edição; mede de novo. As saídas têm
  de ser iguais. Uma leitura nova de respostas entra nessa lista.
- E2E, história do professor: abre a prévia de uma prova em `DRAFT`,
  responde, entrega, vê o resultado, recomeça; a página de resultados e a de
  notas não mostram o professor.
- E2E, visão geral: a tabela mostra pesos, e média e discriminação só na
  prova com tentativas fechadas.

## Critérios de aceitação

- No dev server, o professor abre `…/exams/<prova>/preview`, vê a mesma tela
  do aluno (barra, cronômetro, autosave), entrega e lê o resultado na hora.
- Uma simulação com dissertativa sem nota não bloqueia a liberação das notas
  nem aparece em `grading`, `results`, notas, CSV ou REST.
- Uma prova só de objetivas fica sem pendências ao fechar as tentativas.
- `…/exams/<prova>/questions` responde 404.
- Matricular o instrutor no próprio curso falha por convite, passphrase,
  check-in e pela tela de alunos.
- `pnpm run lint` e `pnpm test` saem 0; `test/openapi-snapshot.spec.ts` e
  `cli/tests/test_generated_in_sync.py` passam.

## Fora do escopo

- Override do peso por prova (`dev/issues/peso-da-questao-por-prova.md`).
- Política de correção do mdq (`dev/issues/politica-de-correcao-da-prova.md`):
  R4 usa `scoreResponse` com os padrões.
- Prioridade dos jobs da simulação na fila do worker.
- Simulação pela CLI ou pela REST: só pela web.
- Itens 4 e 5 da issue da página do professor (prova aberta sem prazo, REST
  de liberação).

## Plano de ação

- T1. Recusar a matrícula do instrutor (`sonnet`, TDD). R1 a R3. Sem
  dependências. Pronto quando os testes dos três caminhos e do comando
  passam.
- T2. Pesos: T1 e T2 de `pesos-e-numeros-de-questao.md` (`sonnet`, TDD). Sem
  dependências. Pronto como descrito lá, com o OpenAPI regenerado.
- T3. Correção automática de objetivas (`opus`, TDD). R4 a R9 e o comando de
  DA1 com `--dry-run`. Sem dependências. Pronto quando os testes de unit
  passam e a prova semeada só de objetivas fecha sem pendências.
- T4. Tabela de questões na visão geral (`sonnet`). R25. Depende de T2.
- T5. Schema e service da simulação (`opus`, TDD). R10 a R18, R22. Depende de
  T1; depende de T3 para R16 dar nota às objetivas.
- T6. Teste diferencial de isolamento (`sonnet`, escrito por quem não fez
  T5). Depende de T5. Entra vermelho.
- T7. Filtro em todos os leitores (`opus`). R19 a R21. Depende de T6. Pronto
  quando T6 fica verde sem alterar o teste.
- T8. Página de prévia (`opus`). R23, R24, R26, remoção de `ExamPreview`,
  actions. Depende de T5; não é entregue antes de T7.
- T9. Seed e histórias e2e (`sonnet`). Depende de T4 e T8.
- T10. Fechamento: `pnpm run openapi:cli`,
  `pnpm exec biome check --write .`, `pnpm run lint`, `pnpm test`, changelog,
  itens 2, 7 e 8 da issue atualizados, spec para `to-review/`.

Em paralelo: T1, T2 e T3. Depois T4 ao lado de T5. T6 e T8 podem começar
juntos depois de T5; T7 segue T6. T2, T3, T5 e T7 tocam o OpenAPI ou o
schema: o snapshot é regenerado uma vez, em T10, e quem mexer antes
regenera para manter `pnpm run test:unit` verde.
