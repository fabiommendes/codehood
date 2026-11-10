---
type: issue
status: todo
tags: [exam, student, numeric]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Texto numérico intermediário inválido salva a resposta como `null`

Plausível. O lado do mdq (`NumericInput.tsx:50-53`) vem do relato da revisão:
o pacote `mdq` não está resolvido neste worktree e não foi relido.

## Problema

Enquanto o aluno digita, o `NumericInput` do mdq emite `null` para um texto
que ainda não é número (`-`, `1e`, `1,`). `change` em
`src/components/exam/ExamAttempt.tsx` trata `null` como resposta limpa e salva
na hora, sem o debounce (`payload === null` chama `saveNow`).

## Passos

1. Aluno tem `12` salvo em uma questão numérica.
2. Apaga e digita `-` (ou `1e`) a caminho de `-5` ou `1e3`.
3. A rede cai, ou a aba fecha, antes do número completo.

## O que o aluno vê e o servidor guarda

A tela mostra o texto digitado, mas o servidor guarda `null`: a resposta `12`
foi apagada por um estado intermediário.

## Direção

No mdq, emitir o texto bruto ou não emitir enquanto for inválido. No cliente,
tratar `null` de questão de texto como edição com debounce, e salvar na hora
só quando vier do botão "Limpar".
