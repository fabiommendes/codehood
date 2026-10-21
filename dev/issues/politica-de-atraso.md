---
type: issue
status: todo
tags: [exams, grading, deadlines]
relatedTo: [exam-state, course-grade, per-student-exceptions]
---

# Política de atraso

Hoje uma resposta fora da janela simplesmente não é aceita. Em listas de
exercício é comum aceitar atraso com desconto (por exemplo, 10% por dia, até
3 dias).

Ideia: a prova declara uma política de atraso (desconto por dia e prazo
máximo). A submissão atrasada é aceita e guarda o atraso; o desconto é
aplicado no cálculo da nota (`exam-result`), não na submissão, para o
professor poder mudar a política depois.

Depende de [exceções por aluno](../specs/to-do/per-student-exceptions.md): o
atraso conta a partir do prazo do aluno, não do prazo geral.
