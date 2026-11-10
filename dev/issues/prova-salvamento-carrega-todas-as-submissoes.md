---
type: issue
status: todo
tags: [exam, performance, db]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Cada salvamento recarrega todas as submissões da tentativa

Plausível, não medido.

## Problema

`response.submit` (`src/db/services/response.service.ts:460`) resolve a
tentativa com `responseInclude()` (`resolveOrCreateAttempt`, `:750-791`),
cria a submissão e relê a resposta inteira com `responseInclude()` (`:507`),
com payloads, validando tudo com `returns`. A action (`src/actions/exam.ts`,
`answer`) descarta o resultado.

## O que o aluno vê

Cada salvamento fica mais lento conforme a tentativa acumula submissões (uma
por salvamento). Em prova longa, com autosave de código, o custo cresce sem
limite e aumenta a chance de timeout.

## Direção

Medir com uma tentativa de milhares de submissões. Se confirmado, dar a
`submit` um caminho que não carregue payloads (só o necessário para checar o
prazo) e devolva só o que a action usa.
