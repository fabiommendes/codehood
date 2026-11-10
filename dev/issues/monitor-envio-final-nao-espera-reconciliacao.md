---
type: issue
status: todo
tags: [exam, editor, monitoring]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Envio final do histórico ignora campo ainda sem reconciliação

## Problema

`AnswerEditCoordinator.flush` só envia campos cuja base já foi reconciliada com o
servidor. Se o aluno entrega a prova antes da primeira inspeção de um campo
terminar (rede lenta, `inspect` pendurado), o histórico pendente daquele campo
não sai no último envio. A resposta não é afetada (R1), só o histórico.

## Correção sugerida

Antes do último envio, esperar as reconciliações em andamento com teto de poucos
segundos (R4), usando o agendador injetado. Fora desse teto, seguir sem o campo.
