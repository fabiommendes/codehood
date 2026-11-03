---
type: issue
status: backlog
tags: [api, security, errors]
kind: defect
created: 2026-11-03
creator: claude
---

# Erro 500 expõe a mensagem da exceção

O doc comment de `responseFromException` (`src/core/error-server.ts:10`) diz
que os detalhes de uma exceção genérica não devem chegar ao usuário. O código
devolve `exception.message` (`:27`) em qualquer ambiente, e
`RuleViolation.toInternalErrorResponse` (`src/core/error.ts:371`) inclui a
mensagem em produção.

## Problema

Uma exceção do Prisma ou um `ZodError` do `returns:` (ADR 0006) chega ao
cliente da REST API com a mensagem crua, que pode citar tabelas, colunas e
valores.

## Critérios de aceitação

- [ ] Em produção, um 500 não traz a mensagem da exceção original.
- [ ] Decidir se `RuleViolation` também esconde a mensagem em produção.
