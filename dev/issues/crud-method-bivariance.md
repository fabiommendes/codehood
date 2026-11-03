---
type: issue
status: backlog
tags: [api, typing, services]
relatedTo: [crud]
kind: defect
priority: low
created: 2026-11-02
creator: Fábio Macêdo Mendes
---

# `Create` e `Upsert` aceitam um service que exige campos a mais

`Create` e `Upsert` (`src/db/base-service.ts:33`) declaram o método com a
sintaxe de método, então o TypeScript compara o parâmetro de forma
bivariante.

## Passos para reproduzir

1. Registrar um `CRUD()` com `create: z.object({ slug: z.string() })` e um
   service cujo `create` recebe `{ slug: string; secret: string }`.
2. Rodar `pnpm exec tsc --noEmit`.

## Esperado

Erro: o schema e os parsers do path não fornecem `secret`.

## Obtido

Compila.

## Correção provável

Declarar `create`/`upsert` como propriedades com tipo de função, e tratar os
erros que aparecerem nos services.
