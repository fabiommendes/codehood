---
type: issue
status: todo
tags: [mdq, exams, shuffle]
---

# O servidor não embaralha as escolhas

Só o pool das questões de ordenação é embaralhado (`src/mdq/shuffle.ts`). As
escolhas de multiple-choice, multiple-selection, true-false e dos blanks de
escolha de um fill-in aparecem na ordem do documento, ignorando `shuffle`
(questão ou prova, com `inherit`). Embaralhar por tentativa, com a mesma
semente do pool, muda a prova de todos os alunos.
