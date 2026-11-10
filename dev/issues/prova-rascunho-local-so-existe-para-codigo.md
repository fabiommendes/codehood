---
type: issue
status: todo
tags: [exam, student, drafts]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Rascunho local só existe para questão de código

Confirmado por leitura.

## Problema

O texto de uma resposta fica em `pending` (um `Map` em memória,
`src/components/exam/ExamAttempt.tsx`) até o servidor confirmar. Só a questão
de código com driver grava cópia no `localStorage`
(`src/components/exam/code-draft.ts`).

## Passos

1. Aluno digita em uma questão de texto, de resposta curta, numérica ou de
   lacunas.
2. Antes do salvamento chegar (debounce de 500 ms, falha de rede, servidor
   fora), a aba recarrega, é descartada pelo navegador ou cai.

## O que o aluno vê e o servidor guarda

Depois do reload a resposta volta à última versão confirmada, sem aviso. O
servidor nunca viu o texto.

## Direção

Generalizar o store de rascunhos de `code-draft.ts` para qualquer payload
(chave por usuário, prova e questão, mesmo TTL), gravar a cada `change` e
comparar com o servidor na abertura, como já se faz para código. Decidir
antes se o conflito mostra os dois textos para todos os tipos. O aviso de
`beforeunload` (corrigido à parte) cobre só a saída voluntária.
