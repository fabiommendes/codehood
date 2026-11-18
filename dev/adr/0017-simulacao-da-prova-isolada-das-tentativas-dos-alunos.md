---
type: adr
status: accepted
tags: [provas, simulacao, preview, correcao, matricula]
created: 2026-11-17
creator: claude
---

# Simulação da prova isolada das tentativas dos alunos

O professor responde a própria prova pela página `exams/[slug]/preview`, que
monta o mesmo `ExamAttempt` do aluno. Essa simulação não entra em nota,
estatística, fila de correção manual nem liberação de notas.

## Decisão

- **A simulação é uma `Response` com `preview = true`.** Não há tabela
  separada, tentativa em memória nem filtro pelo papel do autor. O flag fica só
  em `Response`; submissões, jobs, feedback e pedidos de revisão chegam a ele
  por `submission.response`. Só o service o grava, na criação, e ele não existe
  nos corpos REST de create/update.
- **`slotKey` não marca a simulação.** Ele é 0 na simulação; um valor
  reservado seria lido como sessão de prática (`slotKey != 0`).
- **O instrutor nunca é aluno matriculado no próprio curso.** Todo caminho que
  grava `Enrollment` recusa o instrutor (`src/db/enrollment-guard.ts`, e a
  guarda equivalente da passphrase). Por isso o índice único
  `[authorId, examId, slotKey]` de `Response` não precisa mudar: a simulação do
  professor não colide com uma tentativa dele como aluno.
  `pnpm run manage check-instructor-enrollments` acha matrículas antigas que
  violam a regra.
- **Uma simulação por professor e prova.** "Recomeçar" apaga e recria (nova
  semente de embaralhamento). Ela ignora status, janela e exceções da prova, e
  vai para `results` ao ser entregue.
- **Código da simulação vai para a fila real do worker** com regras de
  prática: envios ilimitados, sem desconto, nota visível. Questões de correção
  manual nunca entram na fila de correção do professor; `feedback.create`
  manual numa submissão de simulação é recusado.

## Regra para código novo

Toda leitura nova de dados de tentativa (a partir de `Response`, `Submission`,
`Feedback`, `GradingJob`, `RegradeRequest` ou do histórico de edição) exclui
`preview = true`, usando os fragmentos de `src/db/preview-filter.ts`
(`realAttempt`, `ofRealAttempts`, `feedbackOfRealAttempts`, `realAttemptSql`),
e ganha um caso em `test/preview-isolation.spec.ts`, que compara a saída do
leitor antes e depois de uma simulação entregue.

`responseFilter.preview` tem padrão `false` em `response.findMany`.

Exceções, que veem a simulação de propósito: `claim`/`renew`/`report` do
worker, os envios lidos pelo próprio autor (`gradingJob.forStudent`), o
feedback lido pelo autor da simulação, as leituras por id da própria
simulação, e o monitor da fila (`gradingJob.summary`, `requeueFailed`), que
descreve a fila real do worker e não as tentativas dos alunos.

## Consequências

- Esquecer o filtro num leitor novo faz a simulação aparecer em médias,
  pendências ou no bloqueio de liberação. O spec de isolamento só pega o
  leitor que estiver nele.
- Não existe modo "ver como aluno" fora da simulação: a prévia é a simulação.
