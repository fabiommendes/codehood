---
type: issue
status: backlog
tags: [exam, grading]
kind: feature
priority: low
created: 2026-11-03
creator: claude
---

# Anular uma questão do exame

Ideia que só existia como requisito, sem story nem spec. **Precisa de
validação antes de virar story.**

## Problema

Uma questão com enunciado errado ou ambíguo não tem como ser retirada da nota
depois que o exame rodou. O instrutor teria que corrigir cada submissão à mão.

## Proposta

- O instrutor anula uma questão dentro de um exame. A anulação fica gravada em
  `QuestionsForExam` (por exemplo `voidedAt`), não por submissão. Hoje o model
  não tem campo para isso (`prisma/schema.prisma:1088-1101`).
- Toda submissão afetada passa a `WILL_NOT_GRADE`, inclusive para quem não
  respondeu.
- O efeito na nota (tirar a questão do denominador, dar nota cheia a todos
  etc.) é configurado por questão e decidido pelo `mdq`, não pelo servidor.

Atenção: hoje `WILL_NOT_GRADE` conta como zero no total (`totalOf`,
`src/services/exam-result.ts:169-175`), o que é o oposto de uma anulação. A
regra de pontuação tem que ser decidida de novo junto com esta feature.

## Critérios de aceitação

- [ ] Story validada pelo humano em `docs/user-stories/instructor.md`.
- [ ] Regra de pontuação de questão anulada definida e testada.
