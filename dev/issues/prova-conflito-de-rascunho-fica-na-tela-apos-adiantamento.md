---
type: issue
status: todo
tags: [exam, student, drafts, code]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Painel de conflito continua na tela depois do salvamento automático

Confirmado por leitura.

## Problema

A 10 s do prazo, `keepNewerDrafts` salva o rascunho mais novo e zera
`conflicts` (`src/components/exam/ExamAttempt.tsx`), mas o painel de conflito
do `CodeEssayAnswer` continua visível. Se o aluno clicar em "Usar a versão do
servidor", `useServer` (`src/components/exam/CodeEssayAnswer.tsx`, perto de
`:143`) descarta o rascunho local e não chama `onChange`.

## Passos

1. Abrir a prova com rascunho local mais novo que a resposta salva.
2. Esperar chegar a 10 s do prazo (o rascunho é salvo no servidor).
3. Clicar em "Usar a versão do servidor".

## O que o aluno vê e o servidor guarda

O editor mostra a versão antiga do servidor; o servidor guarda o rascunho,
que o aluno acabou de descartar na tela. Tela e servidor divergem na entrega.

## Direção

Quando `keepNewerDrafts` salva, avisar o `CodeEssayAnswer` para fechar o
painel, ou fazer `useServer` sempre chamar `onChange` com o código do
servidor.
