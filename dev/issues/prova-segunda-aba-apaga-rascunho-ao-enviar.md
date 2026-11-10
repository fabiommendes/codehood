---
type: issue
status: todo
tags: [exam, student, drafts, tabs]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Enviar de uma aba desatualizada apaga o rascunho da outra

Confirmado por leitura.

## Problema

`submit` chama `finish` e depois `clearDrafts()`
(`src/components/exam/ExamAttempt.tsx`), sem conhecer o pendente de outra aba
da mesma prova. `clearDrafts()` remove todos os rascunhos da prova no
`localStorage`. O mesmo vale quando o prazo passa.

## Passos

1. Aluno abre a prova em duas abas.
2. Na aba B digita código que não chega ao servidor.
3. Na aba A (aberta antes, sem a edição) clica em enviar.

## O que o aluno vê e o servidor guarda

A aba A recarrega como entregue. O rascunho da aba B é apagado e o servidor
guarda a versão da aba A. A única cópia do texto de B some.

## Direção

Antes de apagar, comparar cada rascunho com o que o servidor confirmou e
manter os que diferem; ou carimbar o rascunho com o id da aba e só apagar o da
própria aba. Considerar `BroadcastChannel` para a aba B saber que a prova foi
entregue.
