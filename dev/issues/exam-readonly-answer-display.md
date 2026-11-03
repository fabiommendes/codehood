---
type: issue
status: backlog
tags: [exam-page, tests, mdq-js]
relatedTo: [exam-attempt, question-views]
kind: task
priority: low
created: 2026-09-28
creator: Fábio Macêdo Mendes
---

# Salvar e restaurar respostas só é testado para multiple choice e short answer

## Contexto

O passo "answers save as they change and survive a reload" de
`test/stories/student-exams.test.ts:161` responde, recarrega e confere a
resposta restaurada de uma questão multiple-choice e de uma short-answer
(`test/stories/student-exams.test.ts:176-177`). Os outros tipos que as views do
mdq-js renderizam na página da prova não têm esse teste: multiple selection,
true/false, numeric, essay, fill-in e ordering.

## Requisitos

- R1. Cobrir salvar e restaurar para cada tipo que falta.
  Aceitação: para cada tipo, o teste responde, espera a submissão gravada,
  recarrega a página e confere que a view mostra a mesma resposta.
