---
type: issue
status: todo
tags: [exam, student, drafts]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Rascunho de texto mais antigo que a resposta salva fica sem ninguém olhar

Confirmado por leitura.

## Problema

Para respostas de texto, `restoreDrafts` (`src/components/exam/ExamAttempt.tsx`)
só age quando o rascunho é mais novo que o servidor. Se o servidor tem texto
diferente e mais novo (outra aba ou outro aparelho), o campo mostra o do servidor
e o rascunho continua no `localStorage`, sem painel de conflito (o de código é
`CodeEssayAnswer`).

## O que o aluno vê e o servidor guarda

O servidor guarda o texto mais novo e o aluno o vê. O rascunho antigo some só
na entrega (`clearExam`), no logout ou no TTL.

## Direção

Aceitável como está. Se for preciso, reaproveitar o painel de conflito para
texto.
