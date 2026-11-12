---
type: issue
status: backlog
tags: [services, api, rest, course]
kind: bug
priority: low
created: 2026-11-12
creator: claude
---

# DELETE de curso com filhos responde 500

## Problema

`DELETE /api/course/cs101/ada_2026-2`, feito pelo instrutor do curso no dev
server com os dados do seed, responde 500. O log mostra
`ForeignKeyConstraintViolation` em `tx.course.delete`, no service de curso
(por volta da linha 275): a permissão `course.delete` passa e o Prisma falha
porque o curso ainda tem linhas filhas sem `onDelete: Cascade`.

O cliente recebe um erro interno em vez de uma recusa que ele possa tratar.

## Reproduzir

1. `pnpm run db:reset` e subir o dev server.
2. Autenticar como `ada` e enviar `DELETE /api/course/cs101/ada_2026-2`.

## O que decidir

Não foi investigado qual relação bloqueia a remoção. Duas saídas:

- o service recusa com `RuleViolation` (409) quando o curso tem filhos que não
  devem sumir em cascata (matrículas, tentativas de exame), dizendo quais;
- ou a remoção apaga os filhos que são conteúdo e recusa só pelos que são
  dados de aluno (ADR 0012).

## Critérios de aceitação

- O `DELETE` de um curso com filhos nunca responde 500.
- Teste `unit` no service para o curso com filhos e para o curso vazio.

## Origem

Achado pelos testes de integração do sync bidirecional da CLI
(`cli/tests/test_push_integration.py`), que por isso reutilizam o curso do
seed em vez de criar e apagar um curso próprio.
