---
type: issue
status: backlog
tags: [actions, auth]
kind: bug
priority: low
created: 2026-11-12
creator: claude
---

# Action sem sessão responde 400 em vez de 401

`withServiceErrors` (`src/actions/helpers.ts`) converte em `BAD_REQUEST` todo
erro que `translateServiceError` devolve sem traduzir. `ActionError` estende
`Error`, então o `UNAUTHORIZED` lançado por `requireUser` também entra nesse
ramo: uma Action embrulhada por `withServiceErrors` (por exemplo `exam.answer`)
responde 400 a quem não tem sessão, com a mensagem do erro de autenticação.

## Como reproduzir

Chamar `exam.answer` sem cookie de sessão. A resposta é 400 `BAD_REQUEST`; o
esperado é 401 `UNAUTHORIZED`.

## Correção provável

Em `withServiceErrors`, relançar sem tocar o erro que já é `ActionError`. As
Actions novas de `answerHistory` usam `withActionErrors` e respondem 401.

## Cuidado

O código muda de 400 para 401 em todas as Actions que usam o helper. Conferir se
alguma tela ou teste trata o 400 como sessão expirada antes de mudar.
