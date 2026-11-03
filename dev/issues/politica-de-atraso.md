---
type: issue
status: todo
tags: [exams, grading, deadlines]
relatedTo: [exam-state, course-grade, per-student-exceptions]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Política de atraso

## Contexto

Hoje uma resposta fora da janela simplesmente não é aceita. Em listas de
exercício é comum aceitar atraso com desconto (por exemplo, 10% por dia, até
3 dias).

As [exceções por aluno](../specs/to-review/per-student-exceptions.md), de que
esta issue depende, já estão implementadas (`ExamException` em
`prisma/schema.prisma:1056`; prazo pessoal em `src/services/exam-state.ts:173`).

## Requisitos

- R1. A prova declara uma política de atraso: desconto por dia e prazo
  máximo.
  - Aceitação: uma prova sem política se comporta como hoje.
- R2. A submissão atrasada é aceita dentro do prazo máximo e guarda o atraso,
  contado a partir do prazo do aluno, não do prazo geral.
  - Aceitação: um aluno com exceção de prazo não tem atraso enquanto estiver
    dentro do prazo pessoal.
- R3. O desconto é aplicado no cálculo da nota (`exam-result`), não na
  submissão.
  - Aceitação: mudar a política depois do prazo muda a nota sem alterar as
    submissões.
