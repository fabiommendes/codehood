---
type: issue
status: todo
tags: [grading, audit]
relatedTo: [feedback-service, grade-column-service]
---

# Histórico de alterações de nota

Quando uma nota muda, não dá para saber quem mudou, quando e qual era o valor
anterior. Isso pesa quando um aluno contesta uma nota ou quando um bot grava
notas erradas.

`Feedback` já guarda vários passes por submissão, mas o upsert pelo `ref`
sobrescreve o passe anterior, e `GradeValue` guarda só o valor atual.

Ideia: uma tabela só de inserção com (entidade, chave, valor antigo, valor
novo, autor, momento), escrita pelos services de feedback e de colunas de
nota, e uma visão por aluno na tela de correção.
