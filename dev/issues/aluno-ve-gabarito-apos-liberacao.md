---
type: issue
status: todo
tags: [exam, grading, questions, student, security]
kind: enhancement
priority: medium
created: 2026-11-03
creator: claude
---

# Aluno vê o gabarito depois da liberação das notas

## Problema

Depois que as notas saem, o aluno vê a própria resposta, a nota e o feedback,
mas não a resposta correta. A página do exame só busca a forma pública das
questões para o aluno (`public: true`,
`src/pages/[discipline]/[course]/exams/[slug].astro:93-95`, `:108-120`); o
gabarito só vai para quem tem `enrollment.manage`.

## Proposta

- Quando `attemptState(...).kind === "results"` (o que já usa
  `resultsReleased`, `src/services/exam-state.ts:269-284`), mostrar ao lado de
  cada resposta do aluno a resposta correta.
- O servidor monta um payload próprio de gabarito para o aluno, por tipo de
  questão: só os campos que dizem qual é a resposta certa (escolha correta,
  valor numérico e tolerância, itens na ordem certa etc.) e, se o mdq tiver,
  a explicação da questão.

Restrição dura (decisão do humano): o `uuid` da questão
(`dev/specs/to-do/question-sharing.md`) nunca chega ao aluno nem a ninguém além
do dono da questão. Por isso:

- O payload do gabarito é uma **whitelist explícita**, montada campo a campo.
  Nunca o documento privado cru, nunca o front matter.
- O service que entrega o gabarito declara `returns:` com esse schema estrito
  (ADR 0006, `dev/adr/0006-validacao-de-entrada-e-saida-nos-services.md`), de
  modo que um campo novo no documento privado não vaze por acidente.
- A leitura continua escolhendo as colunas na query, como `questionInclude`
  já faz para o payload privado (`src/db/services/question.service.ts:60-70`),
  e respeita a versão fixada pelo exame.

Ponto aberto: `resultsReleased` é sempre `true` para `PRACTICE` e vale no
fechamento para `QUIZ` (`src/services/exam-state.ts:274-281`). Decidir se a
prática mostra o gabarito logo após cada resposta ou nunca.

## Critérios de aceitação

- [ ] Antes da liberação, a página do aluno não contém o gabarito (checar o
      HTML, não só o que é visível).
- [ ] Depois da liberação, cada questão mostra a resposta do aluno e a
      correta.
- [ ] Teste: uma questão com `uuid` e campos extras no front matter; nenhum
      deles aparece no HTML nem no payload do aluno.
- [ ] O schema `returns:` do gabarito rejeita um campo fora da whitelist.
- [ ] `src/db/bootstrap.ts` tem um exame com notas liberadas para um aluno de
      exemplo.
