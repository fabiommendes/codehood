---
type: spec
status: to-do
tags: [exam, grading, questions, ui]
relatedTo: [exam-result, exam-service, prova-moodle-e-pesos]
---

# Pesos por questão e números `Qn` nas provas

## Contexto

O total de uma prova é a média simples das questões, mas provas reais têm
pesos (a Prova 1 de Paradigmas, vinda do Moodle: q1 a q3 valem 3, q4 vale 2,
as outras 1). O mdq já define o peso: `weight` no frontmatter da questão,
padrão 1, e a nota da prova é `Σ wᵢ·sᵢ / Σ wᵢ`. O campo já chega ao banco em
`QuestionData.publicPayload`/`privatePayload`; só o Codehood o ignora. Além
disso, aluno e professor precisam de um jeito comum de citar uma questão
("qual era a resposta da Q2?"), e hoje as telas do professor só mostram o
título.

A tela de responder já foi refeita no commit `22f4d6c` (número `Qn` ao lado
do cartão, cor pelo estado, bolinhas de peso, título no cabeçalho, questão
visível marcada na barra). Esta spec cobre o resto.

## Requisitos

### Banco

- R1. Nenhuma mudança de schema. O peso de uma questão numa prova é o
  `weight` da versão que a prova usa: a fixada em `QuestionsForExam.version`
  ou, sem versão fixada, a `latest`. Sem `weight`, vale 1.
- R2. O override do peso por prova fica para depois:
  `dev/issues/peso-da-questao-por-prova.md` e, no mdq,
  `dev/issues/peso-da-questao-sobrescrito-no-include-da-prova.md`.

### Entidades e cálculo

- R3. `examQuestionSchema` (`src/core/schemas/exam.ts`) ganha
  `weight: z.number().nonnegative()`, só na saída. `examQuestionInput` não
  muda.
- R4. `ExamService` preenche `weight` em toda leitura de prova, lendo o
  `publicPayload` da versão de R1 (a `latest` pelo `include`, as fixadas numa
  consulta à parte, sem N+1).
- R5. `examResult` (`src/services/exam-result.ts`) recebe
  `questions: { slug: string; weight: number }[]` no lugar de `string[]`. O
  total é `Σ wᵢ·sᵢ / Σ wᵢ`; não respondida e não corrigida contam 0 com o peso
  no denominador; sem questões, `null`; `Σ wᵢ = 0`, 0; qualquer `pending`,
  `null` (como hoje).
- R6. Todos os chamadores de `examResult` passam os pesos:
  `regrade-request.service.ts`, `exam.service.ts` (lista de notas),
  `grading.ts`, `question-stats.ts`, `load-instructor-home.ts`,
  `load-student-home.ts`, e as páginas `exams/index.astro`,
  `exams/[slug].astro` e `exams/[slug]/attempts/[username].astro`. Quem só
  tinha os slugs passa a usar `exam.questions` (que já traz `weight`).
- R7. As estatísticas por questão (`question-stats.ts`) não mudam: descrevem
  cada questão, não a nota final. Só passam os pesos a `examResult` para
  compilar.
- R8. A tabela de notas, o CSV e a home mostram o total ponderado, em %, sem
  mudar o formato.

### REST

- R9. O `GET` da prova devolve `weight` em cada questão (campo novo, não
  quebra o CLI). OpenAPI regenerado. Sem rota nem permissão nova.

### Telas

- R10. Um mesmo rótulo `Qn` (n = posição + 1, igual para todos, já que a
  ordem das questões não é embaralhada) em todas as telas que listam questões
  da prova, ao lado do título:
  1. revisão da tentativa (`exams/[slug]/attempts/[username].astro`),
     professor e aluno;
  2. fila de correção (`exams/[slug]/grading/index.astro`);
  3. correção de uma questão (`grading/[question].astro`), no cabeçalho e no
     título da aba;
  4. estatísticas (`components/grading/QuestionStats.astro`);
  5. pedidos de revisão (`exams/[slug]/regrades.astro`).
- R11. Nas mesmas telas, "peso N" ao lado do `Qn`, só quando alguma questão
  da prova tem peso diferente de 1.
- R12. O rótulo e as bolinhas de peso viram componentes compartilhados:
  `src/components/exam/QuestionNumber.astro` (e a versão Solid já em
  `ExamAttempt.tsx`, movida para `src/components/exam/QuestionNumber.tsx`),
  com as mensagens `exams_attempt_question_short` e `exams_attempt_weight`.
- R13. A tela de responder (já feita) passa a ler o peso de `exam.questions`
  em vez de `question.weight` do payload público, para não divergir quando o
  override de R2 existir.

### CLI

- R14. Nada muda: o `weight` do frontmatter já vai no push.

### Dados de dev

- R15. `src/db/bootstrap.ts` semeia uma prova corrigida e liberada com pesos
  3, 2 e 1, com um aluno cujo total ponderado difere da média simples, para
  ver nas telas o total e o "peso N". As demais provas do seed ficam sem
  pesos, para mostrar que nada aparece quando tudo vale 1.

## Fora do escopo

- Override do peso por prova (R2).
- `penalty` do mdq (piso em 0 por questão): o Codehood segue sem piso.
- Total em pontos ("17,5 / 20"); o total segue em %.
- Separar visualmente enunciado e área de resposta dentro do cartão (exige
  mexer em `components/question/mdq`).

## Plano de ação

- T1. Cálculo com peso (`sonnet`, TDD). Arquivos:
  `src/services/exam-result.ts` e seus testes. Requisitos: R5. Pronto quando
  os testes de `examResult` cobrem pesos diferentes, peso 0, não respondida
  com peso e pendente, e passam.
- T2. Peso na leitura da prova (`sonnet`, TDD). Arquivos:
  `src/core/schemas/exam.ts`, `src/db/services/exam.service.ts` e testes.
  Requisitos: R1, R3, R4, R9. Depende de nada. Pronto quando um teste de
  service mostra o peso da versão fixada e o da `latest`, e o OpenAPI
  regenerado inclui `weight`.
- T3. Chamadores (`sonnet`). Arquivos de R6 e R7. Depende de T1 e T2. Pronto
  quando `pnpm run typecheck` sai 0 e os testes de notas e correção passam.
- T4. Componentes e telas (`sonnet`). Arquivos de R10 a R13. Depende de T2.
  Pronto quando as histórias de T5 passam.
- T5. Histórias e e2e (`sonnet`, antes de T4). Uma história do professor
  (corrige a prova com pesos e vê `Qn`, "peso N" e o total ponderado na
  tabela) e uma do aluno (vê o peso ao responder e o total ponderado depois
  da liberação).
- T6. Seed (`haiku`). `src/db/bootstrap.ts`. Requisitos: R15. Pronto quando
  `pnpm run db:reset` roda e a prova aparece com pesos no dev server.
- T7. Fechamento: `pnpm exec biome check --write .`, `pnpm run lint`, testes
  afetados, changelog, spec para `to-review/`.

## Critérios de aceite

- No dev server, a prova semeada com pesos mostra `Qn` e "peso N" em todas as
  telas de R10, e o total do aluno bate com a conta ponderada.
- Uma prova sem pesos não mostra "peso" em lugar nenhum.
- Na cópia de prod, a `prova-1`, com `weight` no frontmatter de q1 a q4 e
  `codehood push`, mostra os totais iguais aos do Moodle, exceto as
  diferenças já registradas no `report.md` da importação.
