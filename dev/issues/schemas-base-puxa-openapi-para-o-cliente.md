---
type: issue
status: backlog
tags: [performance, api]
kind: enhancement
priority: medium
created: 2026-11-17
creator: claude
---

# `schemas/base.ts` leva zod-to-openapi e `@/urls` para toda página

Depois de aposentar o barrel `@/core/schemas`, as ilhas importam só o submódulo
de que precisam, mas todos eles importam `src/core/schemas/base.ts`. Ele chama
`extendZodWithOpenApi(z)` e importa `@/urls`. O resultado é o chunk `course`
(41 KB gz) em toda página com uma ilha que valida um schema, como o
`ReportDialog` do `AppLayout`.

## O que fazer

Separar o registro OpenAPI dos schemas que as ilhas usam. Por exemplo, os
schemas ficam em módulos puros de zod e o `.openapi(...)` (metadados e
extensão do zod) passa para uma camada que só o servidor importa, a que monta
`src/api/registry`. Medir de novo o JS de `/` depois: hoje são 114 KB gz.

## Cuidado

`test/openapi-snapshot.spec.ts` e o cliente gerado da CLI dependem dos
metadados. A saída do `pnpm run openapi:cli` não pode mudar.
