---
type: issue
status: todo
tags: [grading, audit]
relatedTo: [feedback-service, grade-column-service]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Histórico de alterações de nota

## Contexto

Quando uma nota muda, não dá para saber quem mudou, quando e qual era o valor
anterior. Isso pesa quando um aluno contesta uma nota ou quando um bot grava
notas erradas.

`Feedback` já guarda vários passes por submissão, mas o upsert pelo `ref`
(`src/db/services/feedback.service.ts:334`) sobrescreve o passe anterior, e
`GradeValue` (`prisma/schema.prisma:400`) guarda só o valor atual.

## Requisitos

- R1. Uma tabela só de inserção com (entidade, chave, valor antigo, valor
  novo, autor, momento), escrita pelos services de feedback e de colunas de
  nota.
  - Aceitação: cada mudança de nota por um desses services grava uma linha, e
    nenhuma linha é alterada ou apagada depois.
- R2. Uma visão por aluno do histórico na tela de correção.
  - Aceitação: na tela de correção, o professor vê as mudanças de nota do
    aluno com autor, momento e valores antigo e novo.
