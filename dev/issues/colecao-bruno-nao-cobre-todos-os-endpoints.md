---
type: issue
status: backlog
tags: [api, rest, test]
kind: task
priority: low
created: 2026-11-03
creator: claude
---

# Coleção Bruno não cobre todos os endpoints

O RFC `dev/rfc/como-criar-e-escrever-um-service.md` pede exemplos em `test/bruno/` para todo Service
com REST API.

## Problema

Sem pasta em `test/bruno/`: api-key (`src/api/index.ts:18`), report (`:283`),
repository (`:305`), `blob/missing` (`:408`), `submit` (`:602`).

## Critérios de aceitação

- [ ] Cada endpoint de `src/api/index.ts` tem ao menos um request em
      `test/bruno/`.
